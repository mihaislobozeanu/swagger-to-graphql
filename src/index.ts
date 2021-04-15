import {
  GraphQLFieldConfig,
  GraphQLFieldConfigMap,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLOutputType,
  GraphQLResolveInfo,
  GraphQLSchema,
} from 'graphql';
import refParser, { JSONSchema } from 'json-schema-ref-parser';
import {
  addTitlesToJsonSchemas,
  Endpoint,
  Endpoints,
  getAllEndPoints,
  GraphQLParameters,
  SwaggerSchema,
} from './swagger';
import {
  GraphQLTypeMap,
  jsonSchemaTypeToGraphQL,
  mapParametersToFields,
} from './typeMap';
import { RequestOptions } from './getRequestOptions';
import { RootGraphQLSchema } from './json-schema';

export function parseResponse(response: any, returnType: GraphQLOutputType) {
  const nullableType =
    returnType instanceof GraphQLNonNull ? returnType.ofType : returnType;
  if (
    nullableType instanceof GraphQLObjectType ||
    nullableType instanceof GraphQLList
  ) {
    return response;
  }

  if (nullableType.name === 'String' && typeof response !== 'string') {
    return JSON.stringify(response);
  }

  return response;
}

const getFields = <TContext>(
  endpoints: Endpoints,
  isMutation: boolean,
  gqlTypes: GraphQLTypeMap,
  { callBackend }: Options<TContext>,
): GraphQLFieldConfigMap<any, any> => {
  return Object.keys(endpoints)
    .filter((operationId: string) => {
      return !!endpoints[operationId].mutation === !!isMutation;
    })
    .reduce((result, operationId) => {
      const endpoint: Endpoint = endpoints[operationId];
      const type = jsonSchemaTypeToGraphQL(
        operationId,
        endpoint.response || { type: 'object', properties: {} },
        'response',
        false,
        gqlTypes,
        true,
      );
      const gType: GraphQLFieldConfig<any, any> = {
        type,
        description: endpoint.description,
        args: mapParametersToFields(endpoint.parameters, operationId, gqlTypes),
        resolve: async (
          _source: any,
          args: GraphQLParameters,
          context: TContext,
          info: GraphQLResolveInfo,
        ): Promise<any> => {
          return parseResponse(
            await callBackend({
              context,
              requestOptions: endpoint.getRequestOptions(args),
            }),
            info.returnType,
          );
        },
      };
      return { ...result, [operationId]: gType };
    }, {});
};

const schemaFromEndpoints = <TContext>(
  endpoints: Endpoints,
  options: Options<TContext>,
): GraphQLSchema => {
  const gqlTypes = {};
  const schema = schemaFromEndpointsEx(endpoints, options, gqlTypes);

  const rootType = new GraphQLObjectType({
    name: 'Query',
    fields: schema.query,
  });

  const graphQLSchema: RootGraphQLSchema = {
    query: rootType,
  };

  if (Object.keys(schema.mutation).length) {
    graphQLSchema.mutation = new GraphQLObjectType({
      name: 'Mutation',
      fields: schema.mutation,
    });
  }

  return new GraphQLSchema(graphQLSchema);
};

const schemaFromEndpointsEx = <TContext>(
  endpoints: Endpoints,
  options: Options<TContext>,
  gqlTypes: any,
) => {
  const queryFields = getFields(endpoints, false, gqlTypes, options);
  if (!Object.keys(queryFields).length) {
    throw new Error('Did not find any GET endpoints');
  }
  return {
    query: queryFields,
    mutation: getFields(endpoints, true, gqlTypes, options)
  };
};

export { RequestOptions, JSONSchema };

export interface CallBackendArguments<TContext> {
  context: TContext;
  requestOptions: RequestOptions;
}

export interface Options<TContext> {
  swaggerSchema: string | JSONSchema;
  callBackend: (args: CallBackendArguments<TContext>) => Promise<any>;
}

export const createSchema = async <TContext>(
  options: Options<TContext>,
): Promise<GraphQLSchema> => {
  const schemaWithoutReferences = (await refParser.dereference(
    options.swaggerSchema,
  )) as SwaggerSchema;
  const swaggerSchema = addTitlesToJsonSchemas(schemaWithoutReferences);
  const endpoints = getAllEndPoints(swaggerSchema);
  return schemaFromEndpoints(endpoints, options);
};

export interface Namespaces {
  [typeName: string]: string | JSONSchema;
}
export interface JoinOptions<TContext> {
  swaggerSchema: Namespaces;
  callBackend: (args: CallBackendArguments<TContext>) => Promise<any>;
}

export const joinNCreateSchema = async <TContext>(
  options: JoinOptions<TContext>,
): Promise<GraphQLSchema> => {
  const namespaces = options.swaggerSchema;
  const gqlSchema: any = { query: {}, mutation: {} };
  for (let namespace in namespaces) {
		const schemaWithoutReferences = (await refParser.dereference(
      namespaces[namespace],
    )) as SwaggerSchema;
    const swaggerSchema = addTitlesToJsonSchemas(schemaWithoutReferences);
    const endpoints = getAllEndPoints(swaggerSchema);
    const gqlTypes = { __namespace__: namespace };
    const endpointSchema = schemaFromEndpointsEx(endpoints, options, gqlTypes);
    gqlSchema.query[namespace] = {
			type: new GraphQLObjectType({
				name: namespace,
				fields: endpointSchema.query
			}),
			resolve: () => 'Without this resolver graphql does not resolve further'
		};
		gqlSchema.mutation[namespace] = {
			type: new GraphQLObjectType({
				name: namespace + '_mutation',
				fields: endpointSchema.mutation
			}),
			resolve: () => 'Without this resolver graphql does not resolve further'
		}
	}

  const rootType = new GraphQLObjectType({
		name: 'Query',
		fields: gqlSchema.query
	});

	const graphQLSchema: RootGraphQLSchema = {
		query: rootType
	};

	if (Object.keys(gqlSchema.mutation).length) {
		graphQLSchema.mutation = new GraphQLObjectType({
			name: 'Mutation',
			fields: gqlSchema.mutation
		});
	}

	return new GraphQLSchema(graphQLSchema);
};

export default createSchema;

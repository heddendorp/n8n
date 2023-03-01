import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { configurePostgres } from '../helpers/utils';
import type { PostgresType } from './node.type';

import * as database from './database/Database.resource';

export async function router(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
	let returnData: INodeExecutionData[] = [];

	const items = this.getInputData();
	const resource = this.getNodeParameter<PostgresType>('resource', 0);
	const operation = this.getNodeParameter('operation', 0);

	const { db, pgp } = await configurePostgres.call(this);

	const postgresNodeData = {
		resource,
		operation,
	} as PostgresType;

	switch (postgresNodeData.resource) {
		case 'database':
			returnData = await database[postgresNodeData.operation].execute.call(this, pgp, db, items);
			break;
		default:
			pgp.end();
			throw new NodeOperationError(
				this.getNode(),
				`The operation "${operation}" is not supported!`,
			);
	}

	pgp.end();

	return this.prepareOutputData(returnData);
}
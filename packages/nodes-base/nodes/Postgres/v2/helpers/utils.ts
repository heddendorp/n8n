import type { IExecuteFunctions } from 'n8n-core';
import type { IDataObject, INodeExecutionData } from 'n8n-workflow';

import pgPromise from 'pg-promise';
import type pg from 'pg-promise/typescript/pg-subset';

export type PgpClient = pgPromise.IMain<{}, pg.IClient>;
export type PgpDatabase = pgPromise.IDatabase<{}, pg.IClient>;

export function getItemsCopy(
	items: INodeExecutionData[],
	properties: string[],
	guardedColumns?: { [key: string]: string },
): IDataObject[] {
	let newItem: IDataObject;
	return items.map((item) => {
		newItem = {};
		if (guardedColumns) {
			Object.keys(guardedColumns).forEach((column) => {
				newItem[column] = item.json[guardedColumns[column]];
			});
		} else {
			for (const property of properties) {
				newItem[property] = item.json[property];
			}
		}
		return newItem;
	});
}

export function getItemCopy(
	item: INodeExecutionData,
	properties: string[],
	guardedColumns?: { [key: string]: string },
): IDataObject {
	const newItem: IDataObject = {};
	if (guardedColumns) {
		Object.keys(guardedColumns).forEach((column) => {
			newItem[column] = item.json[guardedColumns[column]];
		});
	} else {
		for (const property of properties) {
			newItem[property] = item.json[property];
		}
	}
	return newItem;
}

export function generateReturning(pgp: PgpClient, returning: string): string {
	return (
		' RETURNING ' +
		returning
			.split(',')
			.map((returnedField) => pgp.as.name(returnedField.trim()))
			.join(', ')
	);
}

export function wrapData(data: IDataObject[]): INodeExecutionData[] {
	if (!Array.isArray(data)) {
		return [{ json: data }];
	}
	return data.map((item) => ({
		json: item,
	}));
}

export async function configurePostgres(this: IExecuteFunctions) {
	const credentials = await this.getCredentials('postgres');
	const largeNumbersOutput = this.getNodeParameter(
		'additionalFields.largeNumbersOutput',
		0,
		'',
	) as string;

	const pgp = pgPromise();

	if (largeNumbersOutput === 'numbers') {
		pgp.pg.types.setTypeParser(20, (value: string) => {
			return parseInt(value, 10);
		});
		pgp.pg.types.setTypeParser(1700, (value: string) => {
			return parseFloat(value);
		});
	}

	const config: IDataObject = {
		host: credentials.host as string,
		port: credentials.port as number,
		database: credentials.database as string,
		user: credentials.user as string,
		password: credentials.password as string,
	};

	if (credentials.allowUnauthorizedCerts === true) {
		config.ssl = {
			rejectUnauthorized: false,
		};
	} else {
		config.ssl = !['disable', undefined].includes(credentials.ssl as string | undefined);
		config.sslmode = (credentials.ssl as string) || 'disable';
	}

	const db = pgp(config);
	return { db, pgp };
}
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
	ICheckProcessedContextData,
	ICheckProcessedOutput,
	IProcessedDataContext,
	IProcessedDataManager,
} from 'n8n-core';
import { getConnection, In, Not } from 'typeorm';
import { createHash } from 'crypto';

// eslint-disable-next-line import/no-cycle
import {
	DatabaseType,
	Db,
	ExternalHooks,
	GenericHelpers,
	IExternalHooksFileData,
	IWorkflowBase,
} from '..';

export class ProcessedDataManagerNativeDatabase implements IProcessedDataManager {
	private static dbType: string;

	async init(): Promise<void> {
		ProcessedDataManagerNativeDatabase.dbType = (await GenericHelpers.getConfigValue(
			'database.type',
		)) as DatabaseType;

		const externalHooks = ExternalHooks();
		const hookFileData: IExternalHooksFileData = {
			workflow: {
				afterUpdate: [
					async (workflow: IWorkflowBase) => {
						// Clean up all the data of no longer existing node
						const contexts = workflow.nodes.map((node) =>
							ProcessedDataManagerNativeDatabase.createContext('node', {
								workflow,
								node,
							}),
						);

						// Add also empty else it will delete all the ones with context 'workflow'.
						// It is not possible to make 'context' nullable as it is a PrimaryColumn.
						contexts.push('');

						await Db.collections.ProcessedData.delete({
							workflowId: workflow.id as string,
							context: Not(In(contexts)),
						});
					},
				],
				afterDelete: [
					async (workflowId: string) => {
						// Clean up all the data of deleted workflows
						await Db.collections.ProcessedData.delete({
							workflowId,
						});
					},
				],
			},
		};

		externalHooks.loadHooks(hookFileData);
	}

	private static createContext(
		context: IProcessedDataContext,
		contextData: ICheckProcessedContextData,
	): string {
		if (context === 'node') {
			if (!contextData.node) {
				throw new Error(`No node information has been provided and can so not use context 'node'`);
			}
			// Use the node ID to make sure that the data can still be accessed and does not get deleted
			// whenver the node gets renamed
			return `n:${contextData.node.id}`;
		}

		return '';
	}

	private static createValueHash(value: string): string {
		return createHash('md5').update(value).digest('base64');
	}

	async checkProcessed(
		items: string[],
		context: IProcessedDataContext,
		contextData: ICheckProcessedContextData,
	): Promise<ICheckProcessedOutput> {
		const returnData: ICheckProcessedOutput = {
			new: [],
			processed: [],
		};

		const hashedItems = items.map((item) =>
			ProcessedDataManagerNativeDatabase.createValueHash(item),
		);

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const processedData = await Db.collections.ProcessedData.find({
			where: {
				workflowId: contextData.workflow.id as string,
				context: ProcessedDataManagerNativeDatabase.createContext(context, contextData),
				value: In(hashedItems),
			},
		});

		hashedItems.forEach((item, index) => {
			if (processedData.find((data) => data.value === item)) {
				returnData.processed.push(items[index]);
			} else {
				returnData.new.push(items[index]);
			}
		});

		return returnData;
	}

	async checkProcessedAndRecord(
		items: string[],
		context: IProcessedDataContext,
		contextData: ICheckProcessedContextData,
	): Promise<ICheckProcessedOutput> {
		const dbContext = ProcessedDataManagerNativeDatabase.createContext(context, contextData);

		if (contextData.workflow.id === undefined) {
			throw new Error('Workflow has to have an ID set!');
		}

		if (ProcessedDataManagerNativeDatabase.dbType === 'sqlite') {
			// SQLite is used as database
			// In SQLite we sadly have to check each of the items one by one instead of in bulk.
			// Because if bulk insert gets used, there is no way to tell it to continue on conflict
			// and with querybuilder, it is not possible because there is no way of knowing which
			// ones got inserted newly and which ones not becuase SQLite does not support "RETURNING".
			const upsertPromises = [];
			// eslint-disable-next-line no-restricted-syntax
			for (const item of items) {
				upsertPromises.push(
					Db.collections.ProcessedData.insert({
						workflowId: contextData.workflow.id.toString(),
						context: dbContext,
						value: ProcessedDataManagerNativeDatabase.createValueHash(item),
					}),
				);
			}
			const promiseResults = await Promise.allSettled(upsertPromises);

			const processedItems: string[] = [];
			const newItems: string[] = [];
			let item: string;
			promiseResults.forEach((result) => {
				item = items.shift() as string;
				if (result.status === 'rejected') {
					if (result.reason.code !== 'SQLITE_CONSTRAINT') {
						// We expect constraint issues, as that means that they value got already processed
						// before but all other ones are actual errors which have to be thrown.

						// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
						throw new Error(`Problem inserting ProcessedData: '${result.reason.toString()}'`);
					}

					// Got already processed
					processedItems.push(item);
				} else {
					// Is new
					newItems.push(item);
				}
			});

			return {
				new: newItems,
				processed: processedItems,
			};
		}

		// Any other database except SQLite is used.
		// As all of the other ones support "RETURNING" the check can be done more efficiently.
		// TODO: Check if that is really the case! Until now just tested with Postgres.
		const insertItems = items.map((item: string) => {
			return {
				workflowId: contextData.workflow.id?.toString(),
				context: dbContext,
				value: ProcessedDataManagerNativeDatabase.createValueHash(item),
			};
		});

		const processedData = await getConnection()
			.createQueryBuilder()
			.insert()
			.orIgnore()
			.returning('value')
			.into('processed_data')
			.values(insertItems)
			.execute();

		const returnData: ICheckProcessedOutput = {
			new: [],
			processed: [],
		};

		let index: number;
		return insertItems.reduce<ICheckProcessedOutput>((acc, currentValue, currentIndex) => {
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			index = processedData.raw.find(
				(item: { value: string }) => item.value === currentValue.value,
			);
			if (index !== undefined) {
				acc.new.push(items[currentIndex]);
				// Remove the value to reduce the search time
				processedData.raw.splice(index, 1);
			} else {
				acc.processed.push(items[currentIndex]);
			}
			return acc;
		}, returnData);
	}

	async removeProcessed(
		items: string[],
		context: IProcessedDataContext,
		contextData: ICheckProcessedContextData,
	): Promise<void> {
		const hashedItems = items.map((item) =>
			ProcessedDataManagerNativeDatabase.createValueHash(item),
		);

		await Db.collections.ProcessedData.delete({
			workflowId: contextData.workflow.id as string,
			context: ProcessedDataManagerNativeDatabase.createContext(context, contextData),
			value: In(hashedItems),
		});
	}
}
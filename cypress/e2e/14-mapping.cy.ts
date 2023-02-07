import { WorkflowPage, NDV, CanvasNode } from '../pages';

const workflowPage = new WorkflowPage();
const ndv = new NDV();
const canvasNode = new CanvasNode();

describe('Data mapping', () => {
	before(() => {
		cy.resetAll();
		cy.skipSetup();
	});

	beforeEach(() => {
		workflowPage.actions.visit();
	});

	it('Should be able to map expressions from table header', () => {
		cy.fixture('Test_workflow-actions_paste-data.json').then((data) => {
			cy.get('body').paste(JSON.stringify(data));
		});
		canvasNode.actions.openNode('Set');
		ndv.actions.executePrevious();
		ndv.actions.switchInputMode('Table');
		ndv.getters.inputDataContainer().get('table', { timeout: 10000 }).should('exist');

		ndv.getters.nodeParameters().find('input[placeholder*="Add Value"]').click();
		ndv.getters.nodeParameters().find('.el-select-dropdown__list li:nth-child(3)').should('have.text', 'String').click();
		ndv.getters.parameterInput('name').should('have.length', 1).find('input').should('have.value', 'propertyName');
		ndv.getters.parameterInput('value').should('have.length', 1).find('input').should('have.value', '');

		ndv.actions.mapDataFromHeader(1, 'value');
		ndv.getters.inlineExpressionEditorInput().should('have.text', '{{ $json.timestamp }}');

		ndv.actions.mapDataFromHeader(2, 'value');
		ndv.getters.inlineExpressionEditorInput().should('have.text', '{{ $json.timestamp }} {{ $json["Readable date"] }}');
	});

	it('Should be able to map expressions from table json, and resolve value based on row', () => {
		cy.fixture('Test_workflow-actions_paste-data.json').then((data) => {
			cy.get('body').paste(JSON.stringify(data));
		});
		canvasNode.actions.openNode('Schedule Trigger');
		ndv.actions.setPinnedData([
			{
				input: [
					{
						"hello world": {
							count: 0,
						},
					}
				]
			},
			{
				input: [
					{
						"hello world": {
							count: 1,
						}
					}
				]
			},
		]);
		ndv.actions.close();

		canvasNode.actions.openNode('Set');
		ndv.actions.switchInputMode('Table');
		ndv.getters.inputDataContainer().get('table', { timeout: 10000 }).should('exist');

		ndv.getters.nodeParameters().find('input[placeholder*="Add Value"]').click();
		ndv.getters.nodeParameters().find('.el-select-dropdown__list li:nth-child(3)').should('have.text', 'String').click();
		ndv.getters.parameterInput('name').should('have.length', 1).find('input').should('have.value', 'propertyName');
		ndv.getters.parameterInput('value').should('have.length', 1).find('input').should('have.value', '');

		ndv.getters.inputTbodyCell(1, 0).find('span').contains('count').realMouseDown();
		ndv.actions.mapToParameter('value');
		ndv.getters.inlineExpressionEditorInput().should('have.text', '{{ $json.input[0]["hello world"].count }}');
		ndv.getters.parameterExpressionPreview('value').should('include.text', '0')

		ndv.getters.inputTbodyCell(1, 0).realHover();
		ndv.getters.parameterExpressionPreview('value')
			.should('include.text', '0')
			.invoke('css', 'color')
			.should('equal', 'rgb(125, 125, 135)');

		ndv.getters.inputTbodyCell(2, 0).realHover();
		ndv.getters.parameterExpressionPreview('value')
				.should('include.text', '1')
				.invoke('css', 'color')
				.should('equal', 'rgb(125, 125, 135)');

		ndv.actions.execute();

		ndv.getters.outputTbodyCell(1, 0).realHover();
		ndv.getters.parameterExpressionPreview('value')
			.should('include.text', '0')
			.invoke('css', 'color')
			.should('equal', 'rgb(125, 125, 135)');

		ndv.getters.outputTbodyCell(2, 0).realHover();
		ndv.getters.parameterExpressionPreview('value')
				.should('include.text', '1')
				.invoke('css', 'color')
				.should('equal', 'rgb(125, 125, 135)');
	});
});
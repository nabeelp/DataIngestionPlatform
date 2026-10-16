import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import definitionSchema from '../../../contracts/definition-contract.schema.json';
import ruleSchema from '../../../contracts/rule-config.schema.json';
import validationRequestSchema from '../../../contracts/messages/validation-request.schema.json';
import validationEventSchema from '../../../contracts/messages/validation-event.schema.json';
import deliveryRequestSchema from '../../../contracts/messages/delivery-request.schema.json';
import definitionExample from '../../../contracts/examples/definition-contract.json';
import validationRequestExample from '../../../contracts/examples/validation-request.json';
import validationEventExample from '../../../contracts/examples/validation-event.json';
import deliveryRequestExample from '../../../contracts/examples/delivery-request.json';

const schemas = [definitionSchema, ruleSchema, validationRequestSchema, validationEventSchema, deliveryRequestSchema];
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
schemas.forEach((schema) => ajv.addSchema(schema));

describe('contract examples', () => {
  const examples = [
    { schema: definitionSchema, payload: definitionExample },
    { schema: validationRequestSchema, payload: validationRequestExample },
    { schema: validationEventSchema, payload: validationEventExample },
    { schema: deliveryRequestSchema, payload: deliveryRequestExample },
  ];

  it.each(examples)('accepts its example payload', ({ schema, payload }) => {
    const validate = ajv.getSchema((schema as { $id: string }).$id)!;
    expect(validate(payload)).toBe(true);
  });

  it('rejects unknown rule types and params', () => {
    const validate = ajv.getSchema('https://dataintegrationplatform.local/contracts/rule-config.schema.json')!;
    expect(validate({
      id: 'invalid',
      name: 'Invalid',
      description: '',
      severity: 'Error',
      executionOrder: 1,
      enabled: true,
      table: null,
      type: 'javascript',
      params: { source: 'not executable' },
    })).toBe(false);
  });
});

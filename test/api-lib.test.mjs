import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsCsv, fromDatabaseAction, getConfig, saoPauloDate, toDatabaseAction, validateAction } from '../api/_lib.mjs';

const config = { eventId: 'evento', eventName: 'Evento', gates: ['Principal'] };
const action = {
  id: 'acao_123456', kind: 'count', deviceId: 'device_123', operator: 'Silva',
  gate: 'Principal', flow: 'in', amount: 1, createdAt: '2026-08-08T12:00:00.000Z'
};

test('configuração da Vercel normaliza portões', () => {
  assert.deepEqual(getConfig({ EVENT_ID: 'x', EVENT_NAME: 'Teste', EVENT_GATES: 'Norte, Sul,Norte' }), {
    eventId: `x-${saoPauloDate()}`, eventBaseId: 'x', eventDate: saoPauloDate(), eventName: 'Teste', gates: ['Norte', 'Sul']
  });
});

test('valida e converte ações para o Supabase sem expor campos extras', () => {
  assert.equal(validateAction(action, config), null);
  assert.equal(validateAction({ ...action, gate: 'Outro' }, config), 'Portão inválido');
  assert.equal(validateAction({ ...action, amount: 5 }, config), 'A contagem aceita apenas uma pessoa por marcação');
  assert.equal(validateAction({ ...action, kind: 'undo', amount: -1, refId: '' }, config), 'Referência de desfazer inválida');
  const row = toDatabaseAction({ ...action, campoPerigoso: 'ignorar' }, config.eventId);
  assert.equal(row.event_id, 'evento');
  assert.equal(row.amount, 1);
  assert.equal('campoPerigoso' in row, false);
});

test('converte a linha do Supabase e exporta CSV', () => {
  const mapped = fromDatabaseAction({
    ...toDatabaseAction(action, config.eventId), received_at: '2026-08-08T12:00:01.000Z'
  });
  assert.equal(mapped.deviceId, action.deviceId);
  assert.equal(mapped.receivedAt, '2026-08-08T12:00:01.000Z');
  assert.match(actionsCsv([mapped]), /Silva/);
});

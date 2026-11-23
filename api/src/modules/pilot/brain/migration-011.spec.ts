import { readFileSync } from 'fs';
import { join } from 'path';

const sql = readFileSync(join(__dirname, '../../../../db/migrations/011_sales_brain.sql'), 'utf8');

describe('migration 011_sales_brain.sql', () => {
  it('nao tem DROP de tabela ou coluna', () => {
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });

  it('todo ADD COLUMN e IF NOT EXISTS', () => {
    const adds = sql.match(/ADD\s+COLUMN\b/gi) ?? [];
    const safe = sql.match(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi) ?? [];
    expect(adds.length).toBeGreaterThan(0);
    expect(safe.length).toBe(adds.length);
  });

  it('e transacional', () => {
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });

  it('adiciona agent_drafts.not_understood boolean NOT NULL DEFAULT false', () => {
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+horizon_agent\.agent_drafts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+not_understood\s+boolean\s+NOT\s+NULL\s+DEFAULT\s+false/i,
    );
  });

  it('adiciona agent_drafts.intended_action text (acao pretendida antes do guardacorpo)', () => {
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+horizon_agent\.agent_drafts\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+intended_action\s+text\s*;/i,
    );
  });

  it('cria a view de prontidao por acao', () => {
    expect(sql).toMatch(/VIEW\s+horizon_agent\.agent_readiness_by_action/);
  });

  it('deduplica antes do indice unico, mantendo o menor id', () => {
    const del = sql.search(/DELETE\s+FROM\s+horizon_agent\.agent_drafts/i);
    const idx = sql.search(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+agent_drafts_trigger_uidx/i);
    expect(del).toBeGreaterThanOrEqual(0);
    expect(idx).toBeGreaterThan(del);
  });
});

import { z } from 'zod';
import rawConfig from '../../data/hero-config.json';

const SpecialNodeSchema = z.object({
  id: z.string(),
  org: z.string(),
  software: z.string(),
  fqdn: z.string(),
  instanceUrl: z.string().url().optional(),
  iconType: z.enum(['logo', 'sdf']),
  shapeId: z.number().int().min(1).max(5).optional(),
  capabilities: z.array(z.string()),
  preferredNeighbors: z.array(z.string()),
  exclusive: z.boolean(),
});

const ConfigSchema = z.object({
  global: z.object({
    maxConcurrentPulses: z.number().int().positive(),
    cooldownMinMs: z.number().int().positive(),
    cooldownMaxMs: z.number().int().positive(),
    lambda: z.number().positive(),
    lambdaRetry: z.number().positive(),
    stepDurationMs: z.number().int().positive(),
    pulseSpeedMin: z.number().positive(),
    pulseSpeedMax: z.number().positive(),
    gridStepPx: z.number().int().positive(),
    specialNodeMinDistance: z.number().int().positive(),
    boundaryMargin: z.number().int().nonnegative(),
    waypointMin: z.number().int().nonnegative(),
    waypointMax: z.number().int().nonnegative().max(10),
    exclusionZone: z.object({
      rowStartPct: z.number().min(0).max(1).default(0.30),
      rowEndPct: z.number().min(0).max(1).default(0.70),
      colStartPct: z.number().min(0).max(1).default(0.15),
      colEndPct: z.number().min(0).max(1).default(0.85),
    }).optional(),
    showIdleEdges: z.boolean().default(true),
    idleEdgeOpacity: z.number().min(0).max(1).default(0.05),
    hubWeight: z.number().positive().default(3.0),
    nodeEdgeGap: z.number().int().nonnegative().default(2),
  }),
  specialNodes: z.array(SpecialNodeSchema).min(1),
});

export const heroConfig = ConfigSchema.parse(rawConfig);
export type HeroConfig = z.infer<typeof ConfigSchema>;
export type SpecialNodeConfig = z.infer<typeof SpecialNodeSchema>;

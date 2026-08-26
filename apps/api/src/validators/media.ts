import { z } from 'zod';

export const altTextSchema = z.string().max(500).optional();

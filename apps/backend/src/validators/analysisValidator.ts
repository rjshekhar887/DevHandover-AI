import { z } from 'zod';

export const analyzeProjectSchema = z.object({
  params: z.object({
    id: z.string().cuid('Invalid project ID'),
  }),
});

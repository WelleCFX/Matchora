import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email('Невалиден имейл').max(254);
export const password = z.string().min(10, 'Паролата трябва да е поне 10 символа').max(128, 'Паролата е твърде дълга');

export const registerSchema = z.object({
  email,
  password,
  confirm: z.string(),
  displayName: z.string().trim().min(2, 'Името е твърде кратко').max(80),
  accountType: z.enum(['client', 'provider']),
  terms: z.literal('on', { error: 'Трябва да приемете общите условия' }),
}).refine((d) => d.password === d.confirm, { message: 'Паролите не съвпадат', path: ['confirm'] });

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export const resetSchema = z.object({ token: z.string().min(20).max(200), password, confirm: z.string() })
  .refine((d) => d.password === d.confirm, { message: 'Паролите не съвпадат', path: ['confirm'] });

export const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Името е твърде кратко').max(80),
  city: z.string().trim().max(60).optional().transform((v) => v || null),
  bio: z.string().trim().max(1000).optional().transform((v) => v || null),
  phone: z.string().trim().max(24).regex(/^[+0-9 ()-]*$/, 'Невалиден телефон').optional().transform((v) => v || null),
  phonePublic: z.string().optional().transform((v) => v === 'on'),
});
export const providerSchema = z.object({
  businessName: z.string().trim().max(120).optional().transform((v) => v || null),
  category: z.string().trim().max(60).optional().transform((v) => v || null),
  serviceArea: z.string().trim().max(160).optional().transform((v) => v || null),
  workHours: z.string().trim().max(160).optional().transform((v) => v || null),
});

export const CATEGORIES = ['Ремонти', 'ВиК', 'Електроуслуги', 'Почистване', 'Транспорт', 'Автоуслуги', 'Красота', 'Уроци', 'Дигитални услуги', 'Счетоводство', 'Събития'] as const;
export const CITIES = ['София', 'Пловдив', 'Варна', 'Бургас', 'Русе', 'Стара Загора', 'Плевен'] as const;

export function firstError(e: z.ZodError): string { return e.issues[0]?.message ?? 'Невалидни данни'; }

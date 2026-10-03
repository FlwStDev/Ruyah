import { z } from "zod";
import {
  COMPOSE_MODES,
  JOB_STATUSES,
  SOCIAL_PROVIDERS,
  MAX_IMAGES_PER_POST,
  DRIP_CAPTION_MODES,
  DRIP_AFTER_POST,
  DRIP_MIN_INTERVAL_MINUTES,
} from "@/lib/constants";
import {
  instagramOptionsSchema,
  redditOptionsSchema,
  xOptionsSchema,
} from "@/lib/social/types";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required.")
  .email("That does not look like an email address.")
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password is too long.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
});

export const composeSchema = z
  .object({
    title: z.string().trim().max(300).optional().nullable(),
    body: z.string().max(40_000).default(""),
    mediaIds: z.array(z.string().min(1)).max(MAX_IMAGES_PER_POST).default([]),
    destinations: z
      .array(z.enum(SOCIAL_PROVIDERS))
      .min(1, "Pick at least one destination.")
      .refine((list) => new Set(list).size === list.length, "Duplicate destination."),
    /** Per-network body replacing the shared one. Empty string means "use shared". */
    overrides: z
      .object({
        x: z.string().max(40_000).optional(),
        reddit: z.string().max(40_000).optional(),
        instagram: z.string().max(40_000).optional(),
      })
      .default({}),
    mode: z.enum(COMPOSE_MODES).default("now"),
    scheduledFor: z.string().datetime({ offset: true }).optional().nullable(),
    x: xOptionsSchema.optional(),
    reddit: redditOptionsSchema.optional(),
    instagram: instagramOptionsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "schedule") {
      if (!value.scheduledFor) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledFor"],
          message: "Pick a date and time to schedule.",
        });
      } else if (new Date(value.scheduledFor).getTime() <= Date.now()) {
        ctx.addIssue({
          code: "custom",
          path: ["scheduledFor"],
          message: "Scheduled time must be in the future.",
        });
      }
    }

    if (value.destinations.includes("reddit")) {
      if (!value.reddit?.subreddit) {
        ctx.addIssue({
          code: "custom",
          path: ["reddit", "subreddit"],
          message: "Reddit needs a subreddit.",
        });
      }
      if (!value.title?.trim()) {
        ctx.addIssue({ code: "custom", path: ["title"], message: "Reddit needs a title." });
      }
    }

    if (value.destinations.includes("instagram") && value.mediaIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["mediaIds"],
        message: "Instagram needs at least one image or video.",
      });
    }

    const hasContent = value.body.trim().length > 0 || value.mediaIds.length > 0;
    if (!hasContent && !value.destinations.includes("reddit")) {
      ctx.addIssue({ code: "custom", path: ["body"], message: "Write something or attach media." });
    }
  });

export type ComposeInput = z.infer<typeof composeSchema>;

export const postFilterSchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const calendarRangeSchema = z.object({
  /** Start of the displayed week, ISO with offset. */
  start: z.string().datetime({ offset: true }),
  days: z.coerce.number().int().min(1).max(31).default(7),
});

export const idParamSchema = z.object({ id: z.string().min(1) });

export const folderDripSchema = z
  .object({
    name: z.string().trim().max(80).optional(),
    folderPath: z.string().trim().min(1, "Folder path is required."),
    intervalMinutes: z.coerce
      .number()
      .int()
      .min(DRIP_MIN_INTERVAL_MINUTES, `At least ${DRIP_MIN_INTERVAL_MINUTES} minutes.`),
    destinations: z
      .array(z.enum(SOCIAL_PROVIDERS))
      .min(1, "Pick at least one destination.")
      .refine((list) => new Set(list).size === list.length, "Duplicate destination."),
    captionMode: z.enum(DRIP_CAPTION_MODES).default("filename"),
    captionText: z.string().max(40_000).optional().default(""),
    redditSubreddit: z.string().trim().max(80).optional().default(""),
    afterPost: z.enum(DRIP_AFTER_POST).default("move"),
    enabled: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.captionMode === "fixed" && !value.captionText.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["captionText"],
        message: "Fixed caption is empty.",
      });
    }
    if (value.destinations.includes("reddit") && !value.redditSubreddit.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["redditSubreddit"],
        message: "Reddit needs a subreddit.",
      });
    }
  });

export const folderDripPatchSchema = z.object({
  name: z.string().trim().max(80).optional(),
  folderPath: z.string().trim().min(1).optional(),
  intervalMinutes: z.coerce.number().int().min(DRIP_MIN_INTERVAL_MINUTES).optional(),
  destinations: z.array(z.enum(SOCIAL_PROVIDERS)).min(1).optional(),
  captionMode: z.enum(DRIP_CAPTION_MODES).optional(),
  captionText: z.string().max(40_000).optional(),
  redditSubreddit: z.string().trim().max(80).optional(),
  afterPost: z.enum(DRIP_AFTER_POST).optional(),
  enabled: z.boolean().optional(),
});

export type FolderDripInput = z.infer<typeof folderDripSchema>;

export const providerCredentialsSchema = z.object({
  provider: z.enum(SOCIAL_PROVIDERS),
  clientId: z.string().trim().min(1, "Client ID is required."),
  clientSecret: z.string().optional(),
  redirectUri: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || /^https?:\/\//.test(value),
      "Redirect URI must start with http:// or https://",
    ),
  redditUserAgent: z.string().trim().max(200).optional(),
  publicBaseUrl: z
    .string()
    .trim()
    .optional()
    .refine(
      (value) => !value || value.startsWith("https://"),
      "PUBLIC_BASE_URL must start with https://",
    ),
});

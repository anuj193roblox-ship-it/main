This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database migrations

`npm run db:migrate` applies `supabase/migrations/*.sql` to your Supabase database in filename order, each file in its own transaction. Applied files are recorded in `nurra_private.applied_migrations` (no access for app users), so each file runs once. It stops at the first error and rolls that file back.

1. Add `DATABASE_URL` to `.env.local`. In the Supabase dashboard, click **Connect**, copy the **Session pooler** connection string, and replace `[YOUR-PASSWORD]` with your database password. If you don't know it, reset it under **Project Settings > Database**. This value is a full-access secret: never commit it, never give it a `NEXT_PUBLIC_` prefix.
2. See where things stand: `npm run db:migrate -- --check` lists which migrations are recorded and whether `public.patients` and `public.invites` exist. Then preview: `npm run db:migrate -- --dry-run`. Both change nothing.
3. Files you already ran by hand in the SQL editor: `npm run db:migrate -- --baseline 0001` (comma-separate several, e.g. `--baseline 0001,0002`). This records them without running them.
4. Apply: `npm run db:migrate`

It refuses to run when `NODE_ENV=production`. After migrations, `supabase/seed.sql` (demo data) is still run by hand.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

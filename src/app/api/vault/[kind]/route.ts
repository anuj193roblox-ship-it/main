import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { NOT_FOUND } from "@/lib/care/context";
import { VAULT_KINDS, type VaultKind } from "@/lib/care/schemas";
import { careApi } from "@/lib/care/server";
import { createVaultEntry } from "@/lib/care/services/vault";

type Params = { params: Promise<{ kind: string }> };

export async function POST(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { kind } = await params;
  if (!VAULT_KINDS.includes(kind as VaultKind)) return respond(NOT_FOUND);
  return respond(await createVaultEntry(kind as VaultKind, await readJsonBody(request), care.db, care.ctx));
}

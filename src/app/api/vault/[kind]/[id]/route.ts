import { readJsonBody, rejectCrossSite, respond } from "@/lib/auth/http";
import { NOT_FOUND } from "@/lib/care/context";
import { VAULT_KINDS, type VaultKind } from "@/lib/care/schemas";
import { careApi } from "@/lib/care/server";
import { deleteVaultEntry, updateVaultEntry } from "@/lib/care/services/vault";

type Params = { params: Promise<{ kind: string; id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { kind, id } = await params;
  if (!VAULT_KINDS.includes(kind as VaultKind)) return respond(NOT_FOUND);
  return respond(await updateVaultEntry(kind as VaultKind, id, await readJsonBody(request), care.db, care.ctx));
}

export async function DELETE(request: Request, { params }: Params) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const care = await careApi();
  if (!care.ok) return care.response;
  const { kind, id } = await params;
  if (!VAULT_KINDS.includes(kind as VaultKind)) return respond(NOT_FOUND);
  return respond(await deleteVaultEntry(kind as VaultKind, id, care.db, care.ctx));
}

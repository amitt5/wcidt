// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticationCreds, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";

type AnySupabaseClient = SupabaseClient<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function useSupabaseAuthState(supabase: AnySupabaseClient) {
  async function readData(key: string): Promise<unknown> {
    const { data } = await supabase
      .from("whatsapp_auth_state")
      .select("value")
      .eq("key", key)
      .single();
    if (!data?.value) return null;
    return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver);
  }

  async function writeData(key: string, value: unknown): Promise<void> {
    const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
    await supabase.from("whatsapp_auth_state").upsert(
      { key, value: serialized, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  }

  async function removeData(key: string): Promise<void> {
    await supabase.from("whatsapp_auth_state").delete().eq("key", key);
  }

  const storedCreds = await readData("creds");
  const creds: AuthenticationCreds =
    (storedCreds as AuthenticationCreds) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(`${type}-${id}`);
              if (value == null) return;
              if (type === "app-state-sync-key") {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                result[id] = proto.Message.AppStateSyncKeyData.fromObject(value as any) as any;
              } else {
                result[id] = value as SignalDataTypeMap[T];
              }
            })
          );
          return result;
        },
        set: async (data: { [category: string]: { [id: string]: unknown } }) => {
          const tasks: Promise<void>[] = [];
          for (const [category, categoryData] of Object.entries(data)) {
            for (const [id, value] of Object.entries(categoryData)) {
              const dbKey = `${category}-${id}`;
              tasks.push(value != null ? writeData(dbKey, value) : removeData(dbKey));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData("creds", creds),
  };
}

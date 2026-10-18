import Gio from "gi://Gio";
import Secret from "gi://Secret";

Gio._promisify(Secret, "password_lookup", "password_lookup_finish");
Gio._promisify(Secret, "password_store", "password_store_finish");
Gio._promisify(Secret, "password_clear", "password_clear_finish");

const SCHEMA = Secret.Schema.new("org.gnome.shell.extensions.pr-monitor", Secret.SchemaFlags.NONE, {
  kind: Secret.SchemaAttributeType.STRING,
});

const ATTRIBUTES = { kind: "personal-access-token" };

export function lookupToken() {
  return Secret.password_lookup(SCHEMA, ATTRIBUTES, null);
}

export function storeToken(token) {
  return Secret.password_store(
    SCHEMA,
    ATTRIBUTES,
    Secret.COLLECTION_DEFAULT,
    "PR Monitor: Azure DevOps token",
    token,
    null,
  );
}

export function clearToken() {
  return Secret.password_clear(SCHEMA, ATTRIBUTES, null);
}

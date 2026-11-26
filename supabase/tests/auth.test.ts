import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  signInByMagicLink,
  testEmail,
  type TestUser,
} from "./helpers";

// upnext is email sign-in only (magic link or code). The Auth layer must refuse
// passwords too, or anyone could claim an address they don't own with a password
// sign-up and keep a way into that account after its real owner signs in.
describe("auth: email sign-in only", () => {
  const cleanup: string[] = [];

  afterAll(async () => {
    const admin = adminClient();
    for (const id of cleanup) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    }
  });

  test("a password sign-up gets no session, and the password never signs anyone in", async () => {
    const email = testEmail("mallory");
    const password = randomBytes(16).toString("hex");

    const signUp = await anonClient().auth.signUp({ email, password });
    expect(signUp.data.session).toBeNull();

    // The address's real owner signs in by magic link, which confirms the account.
    const owner = await signInByMagicLink(email);
    const { data: ownerUser, error: ownerError } = await owner.auth.getUser();
    expect(ownerError).toBeNull();
    cleanup.push(ownerUser.user!.id);

    // The password chosen at sign-up still opens nothing.
    const signIn = await anonClient().auth.signInWithPassword({ email, password });
    expect(signIn.error).not.toBeNull();
    expect(signIn.data.session).toBeNull();
  });

  test("a signed-in user can't set a password", async () => {
    const user: TestUser = await createTestUser("pat");
    cleanup.push(user.id);
    const password = randomBytes(16).toString("hex");

    const { error } = await user.client.auth.updateUser({ password });
    expect(error).not.toBeNull();

    const signIn = await anonClient().auth.signInWithPassword({ email: user.email, password });
    expect(signIn.error).not.toBeNull();
    expect(signIn.data.session).toBeNull();
  });
});

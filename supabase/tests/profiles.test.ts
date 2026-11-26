import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  deleteTestUsers,
  type TestUser,
} from "./helpers";

describe("profiles", () => {
  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    a = await createTestUser("ada");
    b = await createTestUser("bob");
  });

  afterAll(async () => {
    await deleteTestUsers([a, b]);
  });

  test("signing up creates a profile with a generated username", async () => {
    const { data, error } = await a.client
      .from("profiles")
      .select("*")
      .eq("id", a.id)
      .single();
    expect(error).toBeNull();
    expect(data?.username).toMatch(/^user-[a-z0-9]{8}$/);
    expect(data?.username).not.toContain("ada");
    expect(data?.library_private).toBe(false);
  });

  test("anyone can read profiles", async () => {
    const { data, error } = await anonClient()
      .from("profiles")
      .select("id")
      .eq("id", a.id);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  test("INV-001: a user can't change another user's profile", async () => {
    const { data, error } = await b.client
      .from("profiles")
      .update({ library_private: true })
      .eq("id", a.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);

    const { data: row } = await adminClient()
      .from("profiles")
      .select("library_private")
      .eq("id", a.id)
      .single();
    expect(row?.library_private).toBe(false);
  });

  test("a user can change their own library_private", async () => {
    const { data, error } = await a.client
      .from("profiles")
      .update({ library_private: true })
      .eq("id", a.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].library_private).toBe(true);
  });

  test("profiles have no email column", async () => {
    const { data, error } = await adminClient()
      .from("profiles")
      .select("*")
      .eq("id", a.id)
      .single();
    expect(error).toBeNull();
    expect(Object.keys(data ?? {}).filter((k) => k.includes("email"))).toEqual([]);
  });
});

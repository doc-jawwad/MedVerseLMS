import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAdminStudentContact } from "../../src/lib/admin/student-360/contact.ts";

describe("Admin Student 360 contact resolution", () => {
  it("does not access Auth metadata or return contact without biodata permission", async () => {
    let called = false;
    const contact = await resolveAdminStudentContact({
      canReadBiodata: false,
      profileContact: "+923001234567",
      loadAuthMetadata: async () => {
        called = true;
        return { contact_number: "+923009876543" };
      },
    });
    assert.equal(contact, null);
    assert.equal(called, false);
  });

  it("prefers an existing profile number and avoids privileged lookup", async () => {
    let called = false;
    const contact = await resolveAdminStudentContact({
      canReadBiodata: true,
      profileContact: " +923001234567 ",
      loadAuthMetadata: async () => {
        called = true;
        return { contact_number: "other" };
      },
    });
    assert.equal(contact, "+923001234567");
    assert.equal(called, false);
  });

  it("falls back to signup contact in Auth metadata", async () => {
    const contact = await resolveAdminStudentContact({
      canReadBiodata: true,
      profileContact: null,
      loadAuthMetadata: async () => ({ contact_number: " 03001234567 " }),
    });
    assert.equal(contact, "03001234567");
  });

  it("does not expose arbitrary metadata or an invalid contact type", async () => {
    for (const metadata of [null, [], { contact_number: { phone: "123" } }, { role: "admin" }]) {
      const contact = await resolveAdminStudentContact({
        canReadBiodata: true,
        profileContact: "",
        loadAuthMetadata: async () => metadata,
      });
      assert.equal(contact, null);
    }
  });

  it("tolerates an unavailable Auth service without breaking Student 360", async () => {
    const contact = await resolveAdminStudentContact({
      canReadBiodata: true,
      profileContact: null,
      loadAuthMetadata: async () => { throw new Error("temporary Auth outage"); },
    });
    assert.equal(contact, null);
  });
});

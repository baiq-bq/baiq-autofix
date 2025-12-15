const test = require("node:test");
const assert = require("node:assert/strict");

const { parseAndValidateRegistration } = require("../lib/validation");

function makeFormData(entries) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

test("valid standard registration returns ok", () => {
  const fd = makeFormData({
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    ticketType: "standard",
    countryCode: "ES",
    startDate: "2026-06-10",
    endDate: "2026-06-10",
  });

  const res = parseAndValidateRegistration(fd);
  assert.equal(res.ok, true);
});

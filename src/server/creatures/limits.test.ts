import { describe, expect, test } from "bun:test";

import { visitorAddress, visitorKey } from "./limits";

const SALT = "a-long-enough-test-salt-0123456789";

describe("visitorAddress", () => {
  test("keeps an IPv4 address as it is", () => {
    expect(visitorAddress("203.0.113.7")).toBe("203.0.113.7");
    expect(visitorAddress(null)).toBe("unknown");
  });

  test("turns an IPv6 address into its /64, whichever way it is written", () => {
    const prefix = "2001:db8:1:2::/64";
    for (const address of [
      "2001:db8:1:2::1",
      "2001:0db8:0001:0002:0000:0000:0000:0001",
      "2001:DB8:1:2:aaaa:bbbb:cccc:dddd",
      "2001:db8:1:2::",
      "[2001:db8:1:2::7]",
      "2001:db8:1:2:3:4:5:6%eth0",
    ]) {
      expect(visitorAddress(address)).toBe(prefix);
    }
  });

  test("expands :: wherever it sits", () => {
    expect(visitorAddress("::1")).toBe("0:0:0:0::/64");
    expect(visitorAddress("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorAddress("2001::1:2:3")).toBe("2001:0:0:0::/64");
    expect(visitorAddress("2001:db8:0:0:1::5")).toBe("2001:db8:0:0::/64");
  });

  test("tells different /64s apart", () => {
    expect(visitorAddress("2001:db8:1:2::1")).not.toBe(visitorAddress("2001:db8:1:3::1"));
    expect(visitorAddress("2001:db8:1:2::1")).not.toBe(visitorAddress("2001:db9:1:2::1"));
  });

  test("keeps an IPv4-mapped IPv6 address as the IPv4 address, in either notation", () => {
    expect(visitorAddress("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(visitorAddress("::ffff:cb00:7107")).toBe("203.0.113.7");
    expect(visitorAddress("0:0:0:0:0:ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("drops a port, so each source port is not a new visitor", () => {
    expect(visitorAddress("203.0.113.7:51234")).toBe("203.0.113.7");
    expect(visitorAddress("[2001:db8:1:2::9]:443")).toBe("2001:db8:1:2::/64");
  });

  test("does not read a malformed IPv4 tail as an address", () => {
    expect(visitorAddress("::ffff:1..2.3")).toBe("::ffff:1..2.3");
    expect(visitorAddress("::ffff:1.2.3.999")).toBe("::ffff:1.2.3.999");
  });

  test("leaves something that is not an address as it is, so it is still one visitor", () => {
    expect(visitorAddress("1:2:3")).toBe("1:2:3");
    expect(visitorAddress("1::2::3")).toBe("1::2::3");
    expect(visitorAddress("not-an-address")).toBe("not-an-address");
  });
});

describe("visitorKey", () => {
  test("is one key for every address of a /64, and a different one for another /64 or an IPv4 address", () => {
    const key = visitorKey("2001:db8:1:2::1", SALT);
    expect(visitorKey("2001:db8:1:2:f00d:cafe:1234:5678", SALT)).toBe(key);
    expect(visitorKey("2001:db8:1:3::1", SALT)).not.toBe(key);
    expect(visitorKey("203.0.113.7", SALT)).not.toBe(key);
  });

  test("an IPv4 address keeps the key it always had", () => {
    expect(visitorKey("203.0.113.7", SALT)).toBe(visitorKey("::ffff:203.0.113.7", SALT));
  });
});

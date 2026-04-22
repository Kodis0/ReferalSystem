/**
 * CTA query → signup context (visitor surface).
 *
 * @jest-environment node
 */

import {
  buildSiteCtaJoinRequestBody,
  ctaContextFromURLSearchParams,
} from "../pages/registration/ctaQuery";

function params(qs) {
  return new URLSearchParams(qs);
}

describe("ctaContextFromURLSearchParams", () => {
  it("reads site_public_id and ref / ref_code aliases", () => {
    expect(
      ctaContextFromURLSearchParams(
        params("site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&ref=ABC")
      )
    ).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ref: "ABC",
    });
    expect(
      ctaContextFromURLSearchParams(
        params(
          "site_public_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&ref_code=XYZ"
        )
      )
    ).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ref: "XYZ",
    });
  });

  it("drops non-UUID site values", () => {
    expect(
      ctaContextFromURLSearchParams(params("site=not-valid-uuid"))
    ).toEqual({ site_public_id: undefined, ref: undefined });
  });

  it("returns empty optional fields when missing", () => {
    expect(ctaContextFromURLSearchParams(params(""))).toEqual({
      site_public_id: undefined,
      ref: undefined,
    });
  });

  it("prefers site_public_id over site when both are set", () => {
    expect(
      ctaContextFromURLSearchParams(
        params(
          "site=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb&site_public_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        )
      )
    ).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ref: undefined,
    });
  });

  it("prefers ref_code over ref when both are set", () => {
    expect(
      ctaContextFromURLSearchParams(
        params("site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&ref=LOW&ref_code=HIGH")
      )
    ).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ref: "HIGH",
    });
  });

  it("treats whitespace-only ref as absent", () => {
    expect(
      ctaContextFromURLSearchParams(params("site=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&ref=  "))
    ).toEqual({
      site_public_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ref: undefined,
    });
  });
});

describe("buildSiteCtaJoinRequestBody", () => {
  it("returns null without site id", () => {
    expect(buildSiteCtaJoinRequestBody({})).toBeNull();
    expect(buildSiteCtaJoinRequestBody(undefined)).toBeNull();
  });

  it("matches signup body aliases for CTA join POST", () => {
    const sid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    expect(
      buildSiteCtaJoinRequestBody({ site_public_id: sid, ref: "ABC" })
    ).toEqual({
      site_public_id: sid,
      ref: "ABC",
      ref_code: "ABC",
    });
    expect(
      buildSiteCtaJoinRequestBody({ site_public_id: sid })
    ).toEqual({
      site_public_id: sid,
    });
  });
});

import { describe, expect, it } from "vitest";
import { parseChatError } from "./error-message";

const envelope = JSON.stringify({
    error: "configuration_error",
    message:
        "Agent settings not configured for this project. Configure settings.agent in the CMS before calling the agent API.",
    details: { orgId: "org1", projectId: "proj1" },
});

describe("parseChatError", () => {
    it("shows the envelope message and keeps code and details", () => {
        expect(parseChatError(envelope)).toEqual({
            message:
                "Agent settings not configured for this project. Configure settings.agent in the CMS before calling the agent API.",
            code: "configuration_error",
            details: { orgId: "org1", projectId: "proj1" },
        });
    });

    it("reads an Error whose message is the raw response body", () => {
        const parsed = parseChatError(new Error(envelope));
        expect(parsed?.message).toMatch(/^Agent settings not configured/);
        expect(parsed?.code).toBe("configuration_error");
    });

    it("strips a status prefix in front of the JSON body", () => {
        const parsed = parseChatError(
            `metabind agent /chat 400: {"error":"configuration_error","message":"Project is missing required agent settings (provider, apiKey)"}`,
        );
        expect(parsed).toEqual({
            message: "Project is missing required agent settings (provider, apiKey)",
            code: "configuration_error",
            details: undefined,
        });
    });

    it("prefers an explicit code field over the error field", () => {
        expect(
            parseChatError('{"error":"bad","code":"provider_error","message":"Key rejected"}'),
        ).toMatchObject({ message: "Key rejected", code: "provider_error" });
    });

    it("reads a nested error object", () => {
        expect(
            parseChatError('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}'),
        ).toMatchObject({ message: "invalid x-api-key", code: "authentication_error" });
    });

    it("accepts an already-parsed envelope object", () => {
        expect(
            parseChatError({ error: "unauthorized", message: "Token is not active" }),
        ).toMatchObject({ message: "Token is not active", code: "unauthorized" });
    });

    it("falls back to the raw text when there is no parseable message", () => {
        expect(parseChatError("Failed to fetch")).toEqual({ message: "Failed to fetch" });
        expect(parseChatError('{"error":"unauthorized"}')).toEqual({
            message: '{"error":"unauthorized"}',
        });
        expect(parseChatError("upstream {not json}")).toEqual({
            message: "upstream {not json}",
        });
        expect(parseChatError(new Error("network down"))).toEqual({
            message: "network down",
        });
    });

    it("returns undefined for an empty error", () => {
        expect(parseChatError(undefined)).toBeUndefined();
        expect(parseChatError("")).toBeUndefined();
        expect(parseChatError(new Error(""))).toBeUndefined();
    });
});

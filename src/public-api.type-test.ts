import { AuthBoundary, PublicAuthError } from "effect-email";
import { AuthBoundaryLiveLayer, NormalizedEmail } from "effect-email/domain";
import { MockAuthEmailLayer } from "effect-email/email/mock";
import { AuthApi, AuthApiLive } from "effect-email/http";
import { PasswordHasher, SecureDefaultPasswordPolicy } from "effect-email/password";
import { RateLimiter, UnsafePermissiveRateLimiterLayer } from "effect-email/rate-limit";
import { AuthStorage } from "effect-email/storage";
import { DevMemoryAuthStorageLayer } from "effect-email/storage/dev-memory";
import { AuthToken, AuthTokenLive } from "effect-email/token";
import { EmailPasswordWorkflows, makeEmailPasswordWorkflows } from "effect-email/workflows";

const publicImports = {
  AuthApi,
  AuthApiLive,
  AuthBoundary,
  AuthBoundaryLiveLayer,
  AuthStorage,
  AuthToken,
  AuthTokenLive,
  DevMemoryAuthStorageLayer,
  EmailPasswordWorkflows,
  MockAuthEmailLayer,
  NormalizedEmail,
  PasswordHasher,
  PublicAuthError,
  RateLimiter,
  SecureDefaultPasswordPolicy,
  UnsafePermissiveRateLimiterLayer,
  makeEmailPasswordWorkflows,
};

export const documentedPublicImports = publicImports;

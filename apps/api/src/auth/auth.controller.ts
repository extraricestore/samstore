import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { AuthService, AUTH_SERVICE } from "./auth.service.js";

function statusFor(error: ApiError): HttpStatus {
  switch (error.type) {
    case "validation":
      return HttpStatus.UNPROCESSABLE_ENTITY;
    case "not_found":
      return HttpStatus.NOT_FOUND;
    case "conflict":
      return HttpStatus.CONFLICT;
    case "forbidden":
      return HttpStatus.FORBIDDEN;
    case "unauthorized":
      return HttpStatus.UNAUTHORIZED;
    case "rate_limited":
      return HttpStatus.TOO_MANY_REQUESTS;
  }
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AUTH_SERVICE) private readonly auth: AuthService) {}

  /**
   * POST /auth/register — create a user.
   * Public registration is restricted to STORE_OWNER (platform admins are seeded).
   */
  @Post("register")
  async register(
    @Body() body: { email: string; password: string; name?: string; storeId?: string },
  ) {
    const r = await this.auth.register({ ...body, role: "STORE_OWNER" });
    if (!r.ok) throw new HttpException(r.error, statusFor(r.error));
    return r.value;
  }

  /** POST /auth/login — exchange credentials for a JWT */
  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    const r = await this.auth.login(body);
    if (!r.ok) throw new HttpException(r.error, statusFor(r.error));
    return r.value;
  }
}
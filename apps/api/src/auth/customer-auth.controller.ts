import { Body, Controller, HttpException, HttpStatus, Inject, Post } from "@nestjs/common";
import type { ApiError } from "@sam-store/contracts";
import { CustomerAuthService, CUSTOMER_AUTH_SERVICE } from "./customer-auth.service.js";

function statusFor(error: ApiError): HttpStatus {
  switch (error.type) {
    case "validation": return HttpStatus.UNPROCESSABLE_ENTITY;
    case "conflict": return HttpStatus.CONFLICT;
    case "unauthorized": return HttpStatus.UNAUTHORIZED;
    case "not_found": return HttpStatus.NOT_FOUND;
    case "forbidden": return HttpStatus.FORBIDDEN;
    case "rate_limited": return HttpStatus.TOO_MANY_REQUESTS;
  }
}

@Controller("auth/customer")
export class CustomerAuthController {
  constructor(@Inject(CUSTOMER_AUTH_SERVICE) private readonly auth: CustomerAuthService) {}

  /** POST /auth/customer/register */
  @Post("register")
  async register(@Body() body: { email: string; password: string; name?: string; phone?: string }) {
    const r = await this.auth.register(body);
    if (!r.ok) throw new HttpException(r.error, statusFor(r.error));
    return r.value;
  }

  /** POST /auth/customer/login */
  @Post("login")
  async login(@Body() body: { email: string; password: string }) {
    const r = await this.auth.login(body);
    if (!r.ok) throw new HttpException(r.error, statusFor(r.error));
    return r.value;
  }
}
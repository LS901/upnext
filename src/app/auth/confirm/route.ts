import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Where the emailed sign-in link lands. The link carries a token hash rather than
// relying on a cookie from the browser that asked, so it works in any browser.
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");

  // Sign-in emails only ever send type=email.
  if (tokenHash && type === "email") {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.redirect(new URL("/login?error=link", request.url));
}

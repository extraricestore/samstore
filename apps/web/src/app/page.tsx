import { redirect } from "next/navigation";

// Root path → redirect to the demo storefront. (Admin dashboard lives at /admin)
export default function Home() {
  redirect("/sam-store");
}
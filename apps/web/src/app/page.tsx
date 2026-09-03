import { redirect } from "next/navigation";

// Storefront root — a public store page for a given slug.
export default function StorePage({ params }: { params: Record<string, string> }) {
  // Re-export the page content is handled by [slug], but this route (/) shouldn't 404.
  redirect("/sam-store");
}

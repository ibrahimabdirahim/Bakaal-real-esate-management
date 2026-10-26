import Link from "next/link";
import type { ComponentProps } from "react";
import type { Actor } from "@/server/auth/actor";
import { Notice, PageHeader } from "@/components/ui";

/**
 * Shown instead of a page that needs the building profile before any exists (for example right
 * after the data is cleared): administrators get the link to create it, everyone else whom to ask.
 */
export function NoBuilding({ actor, ...header }: { actor: Actor } & ComponentProps<typeof PageHeader>) {
  return (
    <>
      <PageHeader {...header} />
      <Notice>
        No building has been set up yet.{" "}
        {actor.role === "ADMIN" ? (
          <Link href="/settings" className="font-medium underline">
            Create the building profile in Settings
          </Link>
        ) : (
          "Ask a system administrator to create the building profile."
        )}
      </Notice>
    </>
  );
}

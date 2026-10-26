import { redirect } from "next/navigation";

/** The staff list is now the Staff page itself; this keeps old links and bookmarks working. */
export default function StaffDirectoryRedirect() {
  redirect("/staff");
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { DeletePersonButton } from "@/components/account/DeletePersonButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DOWNLOAD_COVERS, DOWNLOAD_LEAVES_OUT } from "@/lib/account/deletionCopy";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { createClient } from "@/lib/supabase/client";

export function YourDataCard() {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);

  // Fetched rather than linked, so a failure is a message here and not an
  // error page in place of Settings.
  async function download() {
    setDownloading(true);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        toast.error(failureMessage("download your data", res.status));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = "my-two42-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Browsers start the download asynchronously; revoking too soon can cancel it
      // or leave an empty file.
      setTimeout(() => URL.revokeObjectURL(url), 40_000);
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <h2 className="mb-2 text-2xl">Your data</h2>
        <p className="mb-4 text-base text-muted-foreground">
          Download a copy of your data, or delete your account. {DOWNLOAD_COVERS} {DOWNLOAD_LEAVES_OUT}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="outline" onClick={download} disabled={downloading}>
            <Download aria-hidden="true" />
            {downloading ? "Downloading…" : "Download my data"}
          </Button>
          <DeletePersonButton
            url="/api/account"
            subject="self"
            label="Delete my account"
            onDeleted={async () => {
              // A 401 or 404 never reached the route that signs out, and the middleware
              // sends anyone still holding a token from /login to the dashboard.
              await createClient().auth.signOut({ scope: "local" }).catch(() => undefined);
              router.push("/login");
              router.refresh();
            }}
          />
        </div>
      </CardContent>
    </Card>
  );
}

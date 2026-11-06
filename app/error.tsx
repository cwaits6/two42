"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { digestReference, logError } from "@/lib/log";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logError("Page failed to render", error);
  }, [error]);

  const reference = digestReference(error);

  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8 border-border">
        <CardContent className="pt-6">
          <h1 className="font-serif text-3xl text-brand-primary-text mb-4">Something went wrong</h1>
          <p className="text-lg text-muted-foreground">
            This page could not be loaded. Try again, or go back to Home.
          </p>
          {reference && (
            <p className="mt-4 text-base text-muted-foreground">
              Reference: <span className="font-mono">{reference}</span>
            </p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              onClick={() => reset()}
            >
              Try again
            </Button>
            <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
              Go to Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

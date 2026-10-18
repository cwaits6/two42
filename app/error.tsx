"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8 border-border">
        <CardContent className="pt-6">
          <h1 className="font-serif text-3xl text-brand-primary mb-4">Something went wrong</h1>
          <p className="text-lg text-muted-foreground">
            This page could not be loaded. Try again, or go back to Home.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              size="lg"
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
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

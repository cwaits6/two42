import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function NoGroupCard({ discoveryOn }: { discoveryOn: boolean }) {
  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8 border-border">
        <CardContent className="pt-6">
          <h1 className="font-serif text-3xl text-brand-primary mb-4">No group yet</h1>
          <p className="text-lg text-muted-foreground">
            You are not in a group yet. Find a group or ask a leader to add you.
          </p>
          {discoveryOn && (
            <Button
              size="lg"
              className="mt-6 bg-brand-primary hover:bg-brand-primary/90 text-white"
              nativeButton={false}
              render={<Link href="/find-a-group" />}
            >
              Find a group
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

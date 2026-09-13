import { Card, CardContent } from "@/components/ui/card";

/**
 * The fail-closed render for `/[orgSlug]/join`. It is deliberately
 * identical for "org exists but is unresolvable" and "slug matches no
 * org" — a distinguishing message would be an org-existence oracle (same
 * reasoning as app/serving/go/page.tsx).
 */
export function JoinUnavailable() {
  return (
    <div className="container mx-auto px-4 py-20 max-w-lg text-center">
      <Card className="p-8">
        <CardContent className="pt-6">
          <h1 className="text-3xl font-bold text-brand-primary mb-4">
            Join requests unavailable
          </h1>
          <p className="text-lg text-muted-foreground">
            This site isn&apos;t accepting join requests right now — please
            contact your group admin.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

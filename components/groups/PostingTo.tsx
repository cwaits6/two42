/** Names the group a composer writes into. */
export function PostingTo({ groupName }: { groupName: string }) {
  return (
    <p className="text-base text-muted-foreground">
      Posting to <strong className="font-semibold text-foreground">{groupName}</strong>
    </p>
  );
}

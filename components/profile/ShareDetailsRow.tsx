import { CheckRow } from "@/components/profile/CheckRow";

/** The consent to send a new person to their church's records. Always starts unticked unless they ticked it before. */
export function ShareDetailsRow({
  churchName,
  checked,
  onChange,
}: {
  churchName: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div>
      <CheckRow
        id="share_details"
        label={`Share my details with ${churchName}'s office`}
        checked={checked}
        onChange={onChange}
      />
      <p className="pl-8 text-base text-muted-foreground">
        Sends your name, email and phone to the church office once, so they can add you to the church&apos;s records.
      </p>
    </div>
  );
}

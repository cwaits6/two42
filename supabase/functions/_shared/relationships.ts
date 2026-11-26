// A person's place in their household, as profiles.relationship and
// family_members.relationship hold it. The app's FamilyMemberRelationship is this type.
export type Relationship = "primary" | "spouse" | "child" | "parent" | "sibling" | "other";

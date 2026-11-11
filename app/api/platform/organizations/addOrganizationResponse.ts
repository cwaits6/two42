/** The body Add organization answers with once the church is added. */
export interface AddOrganizationResponse {
  success: true;
  orgId: string;
  /** False when the church was added but its first admin's invite was not sent. */
  inviteSent: boolean;
}


export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "about_page": {
                  Row: {
                    "body": string,"group_id": string,"org_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string,"group_id": string,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "body"?: string,"group_id"?: string,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "about_page_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "about_page_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"access_requests": {
                  Row: {
                    "approved_role": string | null,"created_at": string,"email": string,"group_id": string | null,"group_invite_id": string | null,"id": string,"invite_token": string | null,"message": string | null,"name": string,"org_id": string,"reviewed_at": string | null,"reviewed_by": string | null,"signup_token": string | null,"status": string,"token_expires_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_role"?: string | null,"created_at"?: string,"email": string,"group_id"?: string | null,"group_invite_id"?: string | null,"id"?: string,"invite_token"?: string | null,"message"?: string | null,"name": string,"org_id"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"signup_token"?: string | null,"status"?: string,"token_expires_at"?: string | null
                  }
                  Update: {
                    "approved_role"?: string | null,"created_at"?: string,"email"?: string,"group_id"?: string | null,"group_invite_id"?: string | null,"id"?: string,"invite_token"?: string | null,"message"?: string | null,"name"?: string,"org_id"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"signup_token"?: string | null,"status"?: string,"token_expires_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "access_requests_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "access_requests_group_invite_id_fkey"
      columns: ["group_invite_id","org_id"]
isOneToOne: false
      referencedRelation: "group_invites"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "access_requests_invite_token_fkey"
      columns: ["invite_token","org_id"]
isOneToOne: false
      referencedRelation: "family_invites"
      referencedColumns: ["token","org_id"]
    },{
      foreignKeyName: "access_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"announcements": {
                  Row: {
                    "author_id": string | null,"content": string,"created_at": string,"group_id": string,"id": string,"is_published": boolean,"org_id": string,"published_at": string | null,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_id"?: string | null,"content": string,"created_at"?: string,"group_id": string,"id"?: string,"is_published"?: boolean,"org_id"?: string,"published_at"?: string | null,"title": string
                  }
                  Update: {
                    "author_id"?: string | null,"content"?: string,"created_at"?: string,"group_id"?: string,"id"?: string,"is_published"?: boolean,"org_id"?: string,"published_at"?: string | null,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "announcements_author_id_fkey"
      columns: ["author_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "announcements_author_id_fkey"
      columns: ["author_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "announcements_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "announcements_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"calendar_subscription_tokens": {
                  Row: {
                    "created_at": string,"expires_at": string,"id": string,"org_id": string,"token_hash": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"id"?: string,"org_id"?: string,"token_hash": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"id"?: string,"org_id"?: string,"token_hash"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calendar_subscription_tokens_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "calendar_subscription_tokens_user_id_fkey"
      columns: ["user_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "calendar_subscription_tokens_user_id_fkey"
      columns: ["user_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"class_teachers": {
                  Row: {
                    "bio": string,"created_at": string,"group_id": string,"id": string,"org_id": string,"profile_id": string,"sort_order": number,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bio"?: string,"created_at"?: string,"group_id": string,"id"?: string,"org_id"?: string,"profile_id": string,"sort_order"?: number,"title"?: string
                  }
                  Update: {
                    "bio"?: string,"created_at"?: string,"group_id"?: string,"id"?: string,"org_id"?: string,"profile_id"?: string,"sort_order"?: number,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "class_teachers_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "class_teachers_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "class_teachers_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "class_teachers_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"event_calendars": {
                  Row: {
                    "color": string | null,"created_at": string,"created_by": string | null,"group_id": string,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"created_by"?: string | null,"group_id": string,"id"?: string,"name": string,"org_id"?: string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"created_by"?: string | null,"group_id"?: string,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_calendars_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "event_calendars_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "event_calendars_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "event_calendars_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"event_reminder_passes": {
                  Row: {
                    "event_id": string,"occurrence_date": string,"org_id": string,"started_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "event_id": string,"occurrence_date": string,"org_id"?: string,"started_at"?: string
                  }
                  Update: {
                    "event_id"?: string,"occurrence_date"?: string,"org_id"?: string,"started_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_reminder_passes_event_id_fkey"
      columns: ["event_id","org_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "event_reminder_passes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"event_reminder_sends": {
                  Row: {
                    "claimed_at": string | null,"event_id": string,"occurrence_date": string,"org_id": string,"profile_id": string,"sent_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_at"?: string | null,"event_id": string,"occurrence_date": string,"org_id"?: string,"profile_id": string,"sent_at"?: string | null
                  }
                  Update: {
                    "claimed_at"?: string | null,"event_id"?: string,"occurrence_date"?: string,"org_id"?: string,"profile_id"?: string,"sent_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "event_reminder_sends_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "event_reminder_sends_pass_fkey"
      columns: ["event_id","occurrence_date","org_id"]
isOneToOne: false
      referencedRelation: "event_reminder_passes"
      referencedColumns: ["event_id","occurrence_date","org_id"]
    },{
      foreignKeyName: "event_reminder_sends_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "event_reminder_sends_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"events": {
                  Row: {
                    "calendar_event_location": boolean | null,"calendar_event_notes": boolean | null,"calendar_id": string | null,"calendar_meeting_details": boolean | null,"created_at": string,"created_by": string | null,"description": string | null,"end_time": string | null,"group_id": string,"id": string,"is_cancelled": boolean,"is_rsvp_enabled": boolean,"location": string | null,"meeting_id": string | null,"meeting_lead_minutes": number,"meeting_passcode": string | null,"meeting_show_on_dashboard": boolean,"meeting_url": string | null,"org_id": string,"recurrence_count": number | null,"recurrence_end_mode": string | null,"recurrence_frequency": string | null,"recurrence_interval": number,"recurrence_until": string | null,"reminder_days_before": number,"series_id": string | null,"series_occurrence_date": string | null,"start_time": string,"title": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calendar_event_location"?: boolean | null,"calendar_event_notes"?: boolean | null,"calendar_id"?: string | null,"calendar_meeting_details"?: boolean | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"end_time"?: string | null,"group_id": string,"id"?: string,"is_cancelled"?: boolean,"is_rsvp_enabled"?: boolean,"location"?: string | null,"meeting_id"?: string | null,"meeting_lead_minutes"?: number,"meeting_passcode"?: string | null,"meeting_show_on_dashboard"?: boolean,"meeting_url"?: string | null,"org_id"?: string,"recurrence_count"?: number | null,"recurrence_end_mode"?: string | null,"recurrence_frequency"?: string | null,"recurrence_interval"?: number,"recurrence_until"?: string | null,"reminder_days_before"?: number,"series_id"?: string | null,"series_occurrence_date"?: string | null,"start_time": string,"title": string
                  }
                  Update: {
                    "calendar_event_location"?: boolean | null,"calendar_event_notes"?: boolean | null,"calendar_id"?: string | null,"calendar_meeting_details"?: boolean | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"end_time"?: string | null,"group_id"?: string,"id"?: string,"is_cancelled"?: boolean,"is_rsvp_enabled"?: boolean,"location"?: string | null,"meeting_id"?: string | null,"meeting_lead_minutes"?: number,"meeting_passcode"?: string | null,"meeting_show_on_dashboard"?: boolean,"meeting_url"?: string | null,"org_id"?: string,"recurrence_count"?: number | null,"recurrence_end_mode"?: string | null,"recurrence_frequency"?: string | null,"recurrence_interval"?: number,"recurrence_until"?: string | null,"reminder_days_before"?: number,"series_id"?: string | null,"series_occurrence_date"?: string | null,"start_time"?: string,"title"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_calendar_id_fkey"
      columns: ["calendar_id","org_id","group_id"]
isOneToOne: false
      referencedRelation: "event_calendars"
      referencedColumns: ["id","org_id","group_id"]
    },{
      foreignKeyName: "events_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "events_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "events_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_series_id_fkey"
      columns: ["series_id","org_id","group_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","org_id","group_id"]
    }
                  ]
                },"family_invites": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"created_by": string | null,"family_id": string,"family_member_id": string,"id": string,"invite_email": string,"org_id": string,"sent_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"family_id": string,"family_member_id": string,"id"?: string,"invite_email": string,"org_id"?: string,"sent_at"?: string | null,"token"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"family_id"?: string,"family_member_id"?: string,"id"?: string,"invite_email"?: string,"org_id"?: string,"sent_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "family_invites_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_invites_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_invites_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_invites_family_member_id_fkey"
      columns: ["family_member_id","org_id"]
isOneToOne: false
      referencedRelation: "family_members"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_invites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"family_members": {
                  Row: {
                    "avatar_url": string | null,"birth_day": number | null,"birth_month": number | null,"birth_year": number | null,"claimed_profile_id": string | null,"created_at": string,"family_id": string,"first_name": string,"graduation_year": number | null,"id": string,"is_class_member": boolean,"last_name": string | null,"org_id": string,"preferred_name": string | null,"relationship": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"birth_day"?: number | null,"birth_month"?: number | null,"birth_year"?: number | null,"claimed_profile_id"?: string | null,"created_at"?: string,"family_id": string,"first_name": string,"graduation_year"?: number | null,"id"?: string,"is_class_member"?: boolean,"last_name"?: string | null,"org_id"?: string,"preferred_name"?: string | null,"relationship": string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"birth_day"?: number | null,"birth_month"?: number | null,"birth_year"?: number | null,"claimed_profile_id"?: string | null,"created_at"?: string,"family_id"?: string,"first_name"?: string,"graduation_year"?: number | null,"id"?: string,"is_class_member"?: boolean,"last_name"?: string | null,"org_id"?: string,"preferred_name"?: string | null,"relationship"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "family_members_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_members_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_members_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"family_units": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"anniversary": string | null,"anniversary_day": number | null,"anniversary_month": number | null,"anniversary_year": number | null,"city": string | null,"created_at": string,"family_name": string,"id": string,"org_id": string,"phone_home": string | null,"phone_profile_id": string | null,"photo_url": string | null,"postal_code": string | null,"state": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"anniversary_day"?: number | null,"anniversary_month"?: number | null,"anniversary_year"?: number | null,"city"?: string | null,"created_at"?: string,"family_name": string,"id"?: string,"org_id"?: string,"phone_home"?: string | null,"phone_profile_id"?: string | null,"photo_url"?: string | null,"postal_code"?: string | null,"state"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"anniversary_day"?: number | null,"anniversary_month"?: number | null,"anniversary_year"?: number | null,"city"?: string | null,"created_at"?: string,"family_name"?: string,"id"?: string,"org_id"?: string,"phone_home"?: string | null,"phone_profile_id"?: string | null,"photo_url"?: string | null,"postal_code"?: string | null,"state"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "family_units_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "family_units_phone_profile_id_fkey"
      columns: ["phone_profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_units_phone_profile_id_fkey"
      columns: ["phone_profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"feedback": {
                  Row: {
                    "created_at": string,"id": string,"message": string,"org_id": string,"profile_id": string | null,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"message": string,"org_id"?: string,"profile_id"?: string | null,"type": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"message"?: string,"org_id"?: string,"profile_id"?: string | null,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "feedback_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "feedback_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "feedback_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"giving_fund_methods": {
                  Row: {
                    "custom_handle": string,"display_order": number,"fund_id": string,"group_id": string,"method": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "custom_handle": string,"display_order"?: number,"fund_id": string,"group_id": string,"method": string,"org_id"?: string
                  }
                  Update: {
                    "custom_handle"?: string,"display_order"?: number,"fund_id"?: string,"group_id"?: string,"method"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "giving_fund_methods_fund_id_fkey"
      columns: ["fund_id","org_id","group_id"]
isOneToOne: false
      referencedRelation: "giving_funds"
      referencedColumns: ["id","org_id","group_id"]
    },{
      foreignKeyName: "giving_fund_methods_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_fund_methods_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"giving_funds": {
                  Row: {
                    "co_steward_id": string | null,"created_at": string,"created_by": string | null,"description": string | null,"display_order": number,"group_id": string,"id": string,"is_active": boolean,"name": string,"needs_review": boolean,"org_id": string,"retire_on": string | null,"steward_id": string | null,"steward_role": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "co_steward_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"display_order"?: number,"group_id": string,"id"?: string,"is_active"?: boolean,"name": string,"needs_review"?: boolean,"org_id"?: string,"retire_on"?: string | null,"steward_id"?: string | null,"steward_role"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "co_steward_id"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"display_order"?: number,"group_id"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"needs_review"?: boolean,"org_id"?: string,"retire_on"?: string | null,"steward_id"?: string | null,"steward_role"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "giving_funds_co_steward_id_fkey"
      columns: ["co_steward_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_funds_co_steward_id_fkey"
      columns: ["co_steward_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_funds_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_funds_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_funds_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_funds_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "giving_funds_steward_id_fkey"
      columns: ["steward_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "giving_funds_steward_id_fkey"
      columns: ["steward_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"group_invite_uses": {
                  Row: {
                    "access_request_id": string | null,"email": string | null,"group_id": string,"id": string,"invite_id": string,"org_id": string,"outcome": string,"profile_id": string | null,"used_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "access_request_id"?: string | null,"email"?: string | null,"group_id": string,"id"?: string,"invite_id": string,"org_id"?: string,"outcome": string,"profile_id"?: string | null,"used_at"?: string
                  }
                  Update: {
                    "access_request_id"?: string | null,"email"?: string | null,"group_id"?: string,"id"?: string,"invite_id"?: string,"org_id"?: string,"outcome"?: string,"profile_id"?: string | null,"used_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_invite_uses_access_request_id_fkey"
      columns: ["access_request_id","org_id"]
isOneToOne: false
      referencedRelation: "access_requests"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_invite_uses_invite_id_fkey"
      columns: ["invite_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "group_invites"
      referencedColumns: ["id","group_id","org_id"]
    },{
      foreignKeyName: "group_invite_uses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_invite_uses_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_invite_uses_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"group_invites": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expires_at": string | null,"group_id": string,"id": string,"max_uses": number | null,"org_id": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"group_id": string,"id"?: string,"max_uses"?: number | null,"org_id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string | null,"group_id"?: string,"id"?: string,"max_uses"?: number | null,"org_id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_invites_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_invites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"group_join_requests": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"org_id": string,"profile_id": string,"reviewed_at": string | null,"reviewed_by": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"org_id"?: string,"profile_id": string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"org_id"?: string,"profile_id"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_join_requests_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_join_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_join_requests_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_join_requests_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"group_labels": {
                  Row: {
                    "color": string | null,"created_at": string,"group_id": string,"id": string,"name": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"group_id": string,"id"?: string,"name": string,"org_id"?: string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"group_id"?: string,"id"?: string,"name"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_labels_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_labels_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"group_member_labels": {
                  Row: {
                    "applied_at": string,"applied_by": string | null,"group_id": string,"group_member_id": string,"label_id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "applied_at"?: string,"applied_by"?: string | null,"group_id": string,"group_member_id": string,"label_id": string,"org_id"?: string
                  }
                  Update: {
                    "applied_at"?: string,"applied_by"?: string | null,"group_id"?: string,"group_member_id"?: string,"label_id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_member_labels_label_fkey"
      columns: ["label_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "group_labels"
      referencedColumns: ["id","group_id","org_id"]
    },{
      foreignKeyName: "group_member_labels_member_fkey"
      columns: ["group_member_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "group_members"
      referencedColumns: ["id","group_id","org_id"]
    },{
      foreignKeyName: "group_member_labels_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"group_members": {
                  Row: {
                    "added_by": string | null,"group_id": string,"id": string,"joined_at": string,"org_id": string,"profile_id": string,"role": string
                  }
                  ComputedFields: never
                  Insert: {
                    "added_by"?: string | null,"group_id": string,"id"?: string,"joined_at"?: string,"org_id"?: string,"profile_id": string,"role"?: string
                  }
                  Update: {
                    "added_by"?: string | null,"group_id"?: string,"id"?: string,"joined_at"?: string,"org_id"?: string,"profile_id"?: string,"role"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_members_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_members_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_members_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"group_requests": {
                  Row: {
                    "created_at": string,"description": string | null,"group_id": string | null,"id": string,"name": string,"org_id": string,"requested_by": string,"reviewed_at": string | null,"reviewed_by": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"description"?: string | null,"group_id"?: string | null,"id"?: string,"name": string,"org_id"?: string,"requested_by": string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"description"?: string | null,"group_id"?: string | null,"id"?: string,"name"?: string,"org_id"?: string,"requested_by"?: string,"reviewed_at"?: string | null,"reviewed_by"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_requests_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "group_requests_requested_by_fkey"
      columns: ["requested_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_requests_requested_by_fkey"
      columns: ["requested_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"group_settings": {
                  Row: {
                    "calendar_event_location": boolean,"calendar_event_notes": boolean,"calendar_meeting_details": boolean,"event_reminder_default_days": number,"event_reminders_enabled": boolean,"group_id": string,"org_id": string,"serving_link_mode": string | null,"supper_club_enabled": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "calendar_event_location"?: boolean,"calendar_event_notes"?: boolean,"calendar_meeting_details"?: boolean,"event_reminder_default_days"?: number,"event_reminders_enabled"?: boolean,"group_id": string,"org_id"?: string,"serving_link_mode"?: string | null,"supper_club_enabled"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "calendar_event_location"?: boolean,"calendar_event_notes"?: boolean,"calendar_meeting_details"?: boolean,"event_reminder_default_days"?: number,"event_reminders_enabled"?: boolean,"group_id"?: string,"org_id"?: string,"serving_link_mode"?: string | null,"supper_club_enabled"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "group_settings_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "group_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"groups": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"id": string,"is_private": boolean,"join_policy": string,"name": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_private"?: boolean,"join_policy"?: string,"name": string,"org_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"id"?: string,"is_private"?: boolean,"join_policy"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"lecture_series": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"is_archived": boolean,"name": string,"org_id": string,"teacher": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"is_archived"?: boolean,"name": string,"org_id"?: string,"teacher"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"is_archived"?: boolean,"name"?: string,"org_id"?: string,"teacher"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lecture_series_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "lecture_series_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"lectures": {
                  Row: {
                    "created_at": string,"created_by": string | null,"description": string | null,"group_id": string,"id": string,"lecture_date": string | null,"org_id": string,"scripture_reference": string | null,"series_id": string | null,"summary": string | null,"title": string,"video_url": string,"week_number": number | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"group_id": string,"id"?: string,"lecture_date"?: string | null,"org_id"?: string,"scripture_reference"?: string | null,"series_id"?: string | null,"summary"?: string | null,"title": string,"video_url": string,"week_number"?: number | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"description"?: string | null,"group_id"?: string,"id"?: string,"lecture_date"?: string | null,"org_id"?: string,"scripture_reference"?: string | null,"series_id"?: string | null,"summary"?: string | null,"title"?: string,"video_url"?: string,"week_number"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "lectures_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "lectures_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "lectures_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "lectures_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "lectures_series_id_fkey"
      columns: ["series_id","org_id","group_id"]
isOneToOne: false
      referencedRelation: "lecture_series"
      referencedColumns: ["id","org_id","group_id"]
    }
                  ]
                },"org_domain_worker_events": {
                  Row: {
                    "acknowledged_at": string | null,"created_at": string,"detail": string | null,"domain": string,"event": string,"id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "acknowledged_at"?: string | null,"created_at"?: string,"detail"?: string | null,"domain": string,"event": string,"id"?: string,"org_id"?: string
                  }
                  Update: {
                    "acknowledged_at"?: string | null,"created_at"?: string,"detail"?: string | null,"domain"?: string,"event"?: string,"id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_domain_worker_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"org_domains": {
                  Row: {
                    "attach_claim_token": string | null,"attach_claimed_at": string | null,"attached_at": string | null,"created_at": string,"domain": string,"id": string,"last_checked_at": string | null,"org_id": string,"status": Database["public"]['Enums']["org_domain_status"],"verification_token": string,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attach_claim_token"?: string | null,"attach_claimed_at"?: string | null,"attached_at"?: string | null,"created_at"?: string,"domain": string,"id"?: string,"last_checked_at"?: string | null,"org_id"?: string,"status"?: Database["public"]['Enums']["org_domain_status"],"verification_token"?: string,"verified_at"?: string | null
                  }
                  Update: {
                    "attach_claim_token"?: string | null,"attach_claimed_at"?: string | null,"attached_at"?: string | null,"created_at"?: string,"domain"?: string,"id"?: string,"last_checked_at"?: string | null,"org_id"?: string,"status"?: Database["public"]['Enums']["org_domain_status"],"verification_token"?: string,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_domains_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"org_email_domains": {
                  Row: {
                    "cleanup_failed_at": string | null,"created_at": string,"dns_records": NonNullable<Json>,"domain": string,"id": string,"last_checked_at": string | null,"org_id": string,"resend_domain_id": string | null,"status": string,"verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "cleanup_failed_at"?: string | null,"created_at"?: string,"dns_records"?: NonNullable<Json>,"domain": string,"id"?: string,"last_checked_at"?: string | null,"org_id"?: string,"resend_domain_id"?: string | null,"status"?: string,"verified_at"?: string | null
                  }
                  Update: {
                    "cleanup_failed_at"?: string | null,"created_at"?: string,"dns_records"?: NonNullable<Json>,"domain"?: string,"id"?: string,"last_checked_at"?: string | null,"org_id"?: string,"resend_domain_id"?: string | null,"status"?: string,"verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_email_domains_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"org_email_limits": {
                  Row: {
                    "daily_cap": number,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "daily_cap"?: number,"org_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "daily_cap"?: number,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_email_limits_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"org_email_usage": {
                  Row: {
                    "org_id": string,"sent_count": number,"usage_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id"?: string,"sent_count"?: number,"usage_date"?: string
                  }
                  Update: {
                    "org_id"?: string,"sent_count"?: number,"usage_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_email_usage_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "branding": NonNullable<Json>,"created_at": string,"custom_email_domain_enabled": boolean,"directory_visibility": string,"group_creation_policy": string,"group_discovery": boolean,"id": string,"name": string,"prayer_request_retention_months": number | null,"status": Database["public"]['Enums']["org_status"],"timezone": string
                  }
                  ComputedFields: never
                  Insert: {
                    "branding"?: NonNullable<Json>,"created_at"?: string,"custom_email_domain_enabled"?: boolean,"directory_visibility"?: string,"group_creation_policy"?: string,"group_discovery"?: boolean,"id"?: string,"name": string,"prayer_request_retention_months"?: number | null,"status"?: Database["public"]['Enums']["org_status"],"timezone"?: string
                  }
                  Update: {
                    "branding"?: NonNullable<Json>,"created_at"?: string,"custom_email_domain_enabled"?: boolean,"directory_visibility"?: string,"group_creation_policy"?: string,"group_discovery"?: boolean,"id"?: string,"name"?: string,"prayer_request_retention_months"?: number | null,"status"?: Database["public"]['Enums']["org_status"],"timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_admins": {
                  Row: {
                    "created_at": string,"profile_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"profile_id": string
                  }
                  Update: {
                    "created_at"?: string,"profile_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"prayer_comments": {
                  Row: {
                    "body_ciphertext": string,"created_at": string,"hide_name": boolean,"id": string,"only_asker": boolean,"org_id": string,"request_id": string,"writer_hash": string | null,"writer_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body_ciphertext": string,"created_at"?: string,"hide_name"?: boolean,"id": string,"only_asker"?: boolean,"org_id"?: string,"request_id": string,"writer_hash"?: string | null,"writer_id"?: string | null
                  }
                  Update: {
                    "body_ciphertext"?: string,"created_at"?: string,"hide_name"?: boolean,"id"?: string,"only_asker"?: boolean,"org_id"?: string,"request_id"?: string,"writer_hash"?: string | null,"writer_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "prayer_comments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prayer_comments_request_id_fkey"
      columns: ["request_id","org_id"]
isOneToOne: false
      referencedRelation: "prayer_requests"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_comments_request_id_fkey"
      columns: ["request_id","org_id"]
isOneToOne: false
      referencedRelation: "prayer_wall"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_comments_writer_id_fkey"
      columns: ["writer_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_comments_writer_id_fkey"
      columns: ["writer_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"prayer_requests": {
                  Row: {
                    "author_hash": string | null,"author_id": string | null,"body": string | null,"body_ciphertext": string | null,"created_at": string,"group_id": string,"id": string,"is_anonymous": boolean,"is_answered": boolean,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "author_hash"?: string | null,"author_id"?: string | null,"body"?: string | null,"body_ciphertext"?: string | null,"created_at"?: string,"group_id": string,"id"?: string,"is_anonymous"?: boolean,"is_answered"?: boolean,"org_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "author_hash"?: string | null,"author_id"?: string | null,"body"?: string | null,"body_ciphertext"?: string | null,"created_at"?: string,"group_id"?: string,"id"?: string,"is_anonymous"?: boolean,"is_answered"?: boolean,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prayer_requests_author_id_fkey"
      columns: ["author_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_requests_author_id_fkey"
      columns: ["author_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_requests_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"prayer_responses": {
                  Row: {
                    "created_at": string,"group_id": string,"org_id": string,"profile_id": string,"request_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"org_id"?: string,"profile_id": string,"request_id": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"org_id"?: string,"profile_id"?: string,"request_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "prayer_responses_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_responses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "prayer_responses_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_responses_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_responses_request_id_fkey"
      columns: ["request_id","org_id","group_id"]
isOneToOne: false
      referencedRelation: "prayer_requests"
      referencedColumns: ["id","org_id","group_id"]
    },{
      foreignKeyName: "prayer_responses_request_id_fkey"
      columns: ["request_id","org_id","group_id"]
isOneToOne: false
      referencedRelation: "prayer_wall"
      referencedColumns: ["id","org_id","group_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"anniversary": string | null,"approved_at": string | null,"approved_by": string | null,"avatar_url": string | null,"bio": string | null,"birth_day": number | null,"birth_month": number | null,"birth_year": number | null,"city": string | null,"created_at": string,"email": string | null,"email_announcements": boolean,"email_event_reminders": boolean,"email_supper_club": boolean,"employer": string | null,"family_id": string | null,"first_name": string | null,"gender": string | null,"hide_email": boolean,"id": string,"is_unlisted": boolean,"last_name": string | null,"occupation": string | null,"org_id": string,"phone": string | null,"phone_home": string | null,"phone_mobile": string | null,"phone_work": string | null,"postal_code": string | null,"preferred_name": string | null,"relationship": string,"role": string,"setup_completed": boolean,"state": string | null,"suffix": string | null,"title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"approved_at"?: string | null,"approved_by"?: string | null,"avatar_url"?: string | null,"bio"?: string | null,"birth_day"?: number | null,"birth_month"?: number | null,"birth_year"?: number | null,"city"?: string | null,"created_at"?: string,"email"?: string | null,"email_announcements"?: boolean,"email_event_reminders"?: boolean,"email_supper_club"?: boolean,"employer"?: string | null,"family_id"?: string | null,"first_name"?: string | null,"gender"?: string | null,"hide_email"?: boolean,"id": string,"is_unlisted"?: boolean,"last_name"?: string | null,"occupation"?: string | null,"org_id"?: string,"phone"?: string | null,"phone_home"?: string | null,"phone_mobile"?: string | null,"phone_work"?: string | null,"postal_code"?: string | null,"preferred_name"?: string | null,"relationship"?: string,"role"?: string,"setup_completed"?: boolean,"state"?: string | null,"suffix"?: string | null,"title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"approved_at"?: string | null,"approved_by"?: string | null,"avatar_url"?: string | null,"bio"?: string | null,"birth_day"?: number | null,"birth_month"?: number | null,"birth_year"?: number | null,"city"?: string | null,"created_at"?: string,"email"?: string | null,"email_announcements"?: boolean,"email_event_reminders"?: boolean,"email_supper_club"?: boolean,"employer"?: string | null,"family_id"?: string | null,"first_name"?: string | null,"gender"?: string | null,"hide_email"?: boolean,"id"?: string,"is_unlisted"?: boolean,"last_name"?: string | null,"occupation"?: string | null,"org_id"?: string,"phone"?: string | null,"phone_home"?: string | null,"phone_mobile"?: string | null,"phone_work"?: string | null,"postal_code"?: string | null,"preferred_name"?: string | null,"relationship"?: string,"role"?: string,"setup_completed"?: boolean,"state"?: string | null,"suffix"?: string | null,"title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "profiles_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "profiles_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "profiles_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"records_child_suggestions": {
                  Row: {
                    "birth_day": number | null,"birth_month": number | null,"created_at": string,"decided_at": string | null,"decided_by": string | null,"external_person_id": string,"family_id": string,"family_member_id": string | null,"first_name": string | null,"graduation_year": number | null,"id": string,"last_name": string | null,"org_id": string,"photo": string | null,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "birth_day"?: number | null,"birth_month"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"external_person_id": string,"family_id": string,"family_member_id"?: string | null,"first_name"?: string | null,"graduation_year"?: number | null,"id"?: string,"last_name"?: string | null,"org_id"?: string,"photo"?: string | null,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "birth_day"?: number | null,"birth_month"?: number | null,"created_at"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"external_person_id"?: string,"family_id"?: string,"family_member_id"?: string | null,"first_name"?: string | null,"graduation_year"?: number | null,"id"?: string,"last_name"?: string | null,"org_id"?: string,"photo"?: string | null,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_child_suggestions_decided_by_fkey"
      columns: ["decided_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_child_suggestions_decided_by_fkey"
      columns: ["decided_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_child_suggestions_link_fkey"
      columns: ["org_id","family_id"]
isOneToOne: false
      referencedRelation: "records_household_links"
      referencedColumns: ["org_id","family_id"]
    },{
      foreignKeyName: "records_child_suggestions_member_fkey"
      columns: ["family_member_id","org_id"]
isOneToOne: false
      referencedRelation: "family_members"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_connections": {
                  Row: {
                    "base_url": string,"connected_at": string,"connected_by": string | null,"connection_id": string,"key_ciphertext": string,"key_hint": string,"org_id": string,"provider": string
                  }
                  ComputedFields: never
                  Insert: {
                    "base_url": string,"connected_at"?: string,"connected_by"?: string | null,"connection_id"?: string,"key_ciphertext": string,"key_hint": string,"org_id"?: string,"provider": string
                  }
                  Update: {
                    "base_url"?: string,"connected_at"?: string,"connected_by"?: string | null,"connection_id"?: string,"key_ciphertext"?: string,"key_hint"?: string,"org_id"?: string,"provider"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_connections_connected_by_fkey"
      columns: ["connected_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_connections_connected_by_fkey"
      columns: ["connected_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_connections_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"records_field_settings": {
                  Row: {
                    "field": string,"mode": string,"org_id": string,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "field": string,"mode": string,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "field"?: string,"mode"?: string,"org_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_field_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "records_field_settings_updated_by_fkey"
      columns: ["updated_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_field_settings_updated_by_fkey"
      columns: ["updated_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_field_values": {
                  Row: {
                    "church_value": NonNullable<Json>,"field": string,"org_id": string,"profile_id": string,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "church_value"?: NonNullable<Json>,"field": string,"org_id"?: string,"profile_id": string,"state": string,"updated_at"?: string
                  }
                  Update: {
                    "church_value"?: NonNullable<Json>,"field"?: string,"org_id"?: string,"profile_id"?: string,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_field_values_link_fkey"
      columns: ["org_id","profile_id"]
isOneToOne: false
      referencedRelation: "records_person_links"
      referencedColumns: ["org_id","profile_id"]
    }
                  ]
                },"records_household_links": {
                  Row: {
                    "confirmed_at": string,"confirmed_by": string | null,"connection_id": string,"external_family_id": string,"family_id": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "confirmed_at"?: string,"confirmed_by"?: string | null,"connection_id": string,"external_family_id": string,"family_id": string,"org_id"?: string
                  }
                  Update: {
                    "confirmed_at"?: string,"confirmed_by"?: string | null,"connection_id"?: string,"external_family_id"?: string,"family_id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_household_links_confirmed_by_fkey"
      columns: ["confirmed_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_household_links_confirmed_by_fkey"
      columns: ["confirmed_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_household_links_connection_fkey"
      columns: ["org_id","connection_id"]
isOneToOne: false
      referencedRelation: "records_connections"
      referencedColumns: ["org_id","connection_id"]
    },{
      foreignKeyName: "records_household_links_family_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_household_links_family_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_household_links_family_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_household_suggestions": {
                  Row: {
                    "basis": NonNullable<Json>,"connection_id": string,"created_at": string,"external_family_id": string,"family_name": string | null,"id": string,"org_id": string,"people": NonNullable<Json>,"ready": boolean,"target_family_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "basis"?: NonNullable<Json>,"connection_id": string,"created_at"?: string,"external_family_id": string,"family_name"?: string | null,"id"?: string,"org_id"?: string,"people": NonNullable<Json>,"ready": boolean,"target_family_id"?: string | null
                  }
                  Update: {
                    "basis"?: NonNullable<Json>,"connection_id"?: string,"created_at"?: string,"external_family_id"?: string,"family_name"?: string | null,"id"?: string,"org_id"?: string,"people"?: NonNullable<Json>,"ready"?: boolean,"target_family_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_household_suggestions_connection_fkey"
      columns: ["org_id","connection_id"]
isOneToOne: false
      referencedRelation: "records_connections"
      referencedColumns: ["org_id","connection_id"]
    },{
      foreignKeyName: "records_household_suggestions_target_fkey"
      columns: ["target_family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_household_suggestions_target_fkey"
      columns: ["target_family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_household_suggestions_target_fkey"
      columns: ["target_family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_household_values": {
                  Row: {
                    "church_value": NonNullable<Json>,"family_id": string,"field": string,"org_id": string,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "church_value"?: NonNullable<Json>,"family_id": string,"field": string,"org_id"?: string,"state": string,"updated_at"?: string
                  }
                  Update: {
                    "church_value"?: NonNullable<Json>,"family_id"?: string,"field"?: string,"org_id"?: string,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_household_values_link_fkey"
      columns: ["org_id","family_id"]
isOneToOne: false
      referencedRelation: "records_household_links"
      referencedColumns: ["org_id","family_id"]
    }
                  ]
                },"records_intake_requests": {
                  Row: {
                    "consented_at": string,"failure": string | null,"finished_at": string | null,"org_id": string,"profile_id": string,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consented_at"?: string,"failure"?: string | null,"finished_at"?: string | null,"org_id"?: string,"profile_id": string,"state": string
                  }
                  Update: {
                    "consented_at"?: string,"failure"?: string | null,"finished_at"?: string | null,"org_id"?: string,"profile_id"?: string,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_intake_requests_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_intake_requests_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_intake_settings": {
                  Row: {
                    "connection_id": string,"destination_id": string,"destination_name": string,"enabled_at": string,"enabled_by": string | null,"key_ciphertext": string,"key_hint": string,"org_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"destination_id": string,"destination_name": string,"enabled_at"?: string,"enabled_by"?: string | null,"key_ciphertext": string,"key_hint": string,"org_id"?: string
                  }
                  Update: {
                    "connection_id"?: string,"destination_id"?: string,"destination_name"?: string,"enabled_at"?: string,"enabled_by"?: string | null,"key_ciphertext"?: string,"key_hint"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_intake_settings_connection_fkey"
      columns: ["org_id","connection_id"]
isOneToOne: false
      referencedRelation: "records_connections"
      referencedColumns: ["org_id","connection_id"]
    },{
      foreignKeyName: "records_intake_settings_enabled_by_fkey"
      columns: ["enabled_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_intake_settings_enabled_by_fkey"
      columns: ["enabled_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_org_settings": {
                  Row: {
                    "mode": string,"org_id": string,"suggest_children": boolean,"updated_at": string,"updated_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "mode"?: string,"org_id"?: string,"suggest_children"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "mode"?: string,"org_id"?: string,"suggest_children"?: boolean,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_org_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "records_org_settings_updated_by_fkey"
      columns: ["updated_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_org_settings_updated_by_fkey"
      columns: ["updated_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_person_links": {
                  Row: {
                    "connection_id": string,"external_person_id": string,"linked_at": string,"linked_by": string | null,"org_id": string,"profile_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"external_person_id": string,"linked_at"?: string,"linked_by"?: string | null,"org_id"?: string,"profile_id": string
                  }
                  Update: {
                    "connection_id"?: string,"external_person_id"?: string,"linked_at"?: string,"linked_by"?: string | null,"org_id"?: string,"profile_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_person_links_connection_fkey"
      columns: ["org_id","connection_id"]
isOneToOne: false
      referencedRelation: "records_connections"
      referencedColumns: ["org_id","connection_id"]
    },{
      foreignKeyName: "records_person_links_linked_by_fkey"
      columns: ["linked_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_person_links_linked_by_fkey"
      columns: ["linked_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_person_links_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "records_person_links_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"records_person_state": {
                  Row: {
                    "copied_at": string | null,"notice_filled_at": string | null,"notice_seen_at": string | null,"org_id": string,"profile_id": string,"review_reason": string | null,"review_since": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "copied_at"?: string | null,"notice_filled_at"?: string | null,"notice_seen_at"?: string | null,"org_id"?: string,"profile_id": string,"review_reason"?: string | null,"review_since"?: string | null
                  }
                  Update: {
                    "copied_at"?: string | null,"notice_filled_at"?: string | null,"notice_seen_at"?: string | null,"org_id"?: string,"profile_id"?: string,"review_reason"?: string | null,"review_since"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_person_state_link_fkey"
      columns: ["org_id","profile_id"]
isOneToOne: true
      referencedRelation: "records_person_links"
      referencedColumns: ["org_id","profile_id"]
    }
                  ]
                },"records_refresh_state": {
                  Row: {
                    "connection_id": string,"cursor": string | null,"last_counts": NonNullable<Json>,"last_refreshed_at": string | null,"org_id": string,"running_since": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "connection_id": string,"cursor"?: string | null,"last_counts"?: NonNullable<Json>,"last_refreshed_at"?: string | null,"org_id"?: string,"running_since"?: string | null
                  }
                  Update: {
                    "connection_id"?: string,"cursor"?: string | null,"last_counts"?: NonNullable<Json>,"last_refreshed_at"?: string | null,"org_id"?: string,"running_since"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "records_refresh_state_connection_fkey"
      columns: ["org_id","connection_id"]
isOneToOne: false
      referencedRelation: "records_connections"
      referencedColumns: ["org_id","connection_id"]
    },{
      foreignKeyName: "records_refresh_state_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"rsvps": {
                  Row: {
                    "created_at": string,"event_id": string,"id": string,"occurrence_date": string,"org_id": string,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_id": string,"id"?: string,"occurrence_date": string,"org_id"?: string,"status": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_id"?: string,"id"?: string,"occurrence_date"?: string,"org_id"?: string,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "rsvps_event_id_fkey"
      columns: ["event_id","org_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "rsvps_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "rsvps_user_id_fkey"
      columns: ["user_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "rsvps_user_id_fkey"
      columns: ["user_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"serving_broadcasts": {
                  Row: {
                    "created_at": string,"id": string,"open_dates": (string)[],"org_id": string,"recipient_count": number,"sent_by": string | null,"subject": string,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"open_dates"?: (string)[],"org_id"?: string,"recipient_count"?: number,"sent_by"?: string | null,"subject": string,"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"open_dates"?: (string)[],"org_id"?: string,"recipient_count"?: number,"sent_by"?: string | null,"subject"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "serving_broadcasts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "serving_broadcasts_sent_by_fkey"
      columns: ["sent_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_broadcasts_sent_by_fkey"
      columns: ["sent_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_broadcasts_team_id_fkey"
      columns: ["team_id","org_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"serving_reminder_passes": {
                  Row: {
                    "org_id": string,"send_date": string,"started_at": string,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id"?: string,"send_date": string,"started_at"?: string,"team_id": string
                  }
                  Update: {
                    "org_id"?: string,"send_date"?: string,"started_at"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "serving_reminder_passes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "serving_reminder_passes_team_id_fkey"
      columns: ["team_id","org_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"serving_reminder_sends": {
                  Row: {
                    "claimed_at": string | null,"org_id": string,"profile_id": string,"send_date": string,"sent_at": string | null,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_at"?: string | null,"org_id"?: string,"profile_id": string,"send_date": string,"sent_at"?: string | null,"team_id": string
                  }
                  Update: {
                    "claimed_at"?: string | null,"org_id"?: string,"profile_id"?: string,"send_date"?: string,"sent_at"?: string | null,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "serving_reminder_sends_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "serving_reminder_sends_pass_fkey"
      columns: ["team_id","send_date","org_id"]
isOneToOne: false
      referencedRelation: "serving_reminder_passes"
      referencedColumns: ["team_id","send_date","org_id"]
    },{
      foreignKeyName: "serving_reminder_sends_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_reminder_sends_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"serving_signup_attendees": {
                  Row: {
                    "org_id": string,"profile_id": string,"signup_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id"?: string,"profile_id": string,"signup_id": string
                  }
                  Update: {
                    "org_id"?: string,"profile_id"?: string,"signup_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "serving_signup_attendees_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "serving_signup_attendees_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signup_attendees_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signup_attendees_signup_id_fkey"
      columns: ["signup_id","org_id"]
isOneToOne: false
      referencedRelation: "serving_signups"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"serving_signups": {
                  Row: {
                    "created_at": string,"created_by": string,"family_id": string | null,"id": string,"org_id": string,"service_date": string,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by": string,"family_id"?: string | null,"id"?: string,"org_id"?: string,"service_date": string,"team_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string,"family_id"?: string | null,"id"?: string,"org_id"?: string,"service_date"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "serving_signups_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signups_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signups_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signups_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signups_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "serving_signups_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "serving_signups_team_id_fkey"
      columns: ["team_id","org_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"serving_team_settings": {
                  Row: {
                    "date_from": string | null,"date_to": string | null,"enabled": boolean,"extra_weeks": number,"org_id": string,"reminder_days": (number)[],"reminder_method": string,"schedule": string,"send_hour": number | null,"team_id": string,"updated_at": string,"updated_by": string | null,"window_weeks": number
                  }
                  ComputedFields: never
                  Insert: {
                    "date_from"?: string | null,"date_to"?: string | null,"enabled"?: boolean,"extra_weeks"?: number,"org_id"?: string,"reminder_days"?: (number)[],"reminder_method"?: string,"schedule"?: string,"send_hour"?: number | null,"team_id": string,"updated_at"?: string,"updated_by"?: string | null,"window_weeks"?: number
                  }
                  Update: {
                    "date_from"?: string | null,"date_to"?: string | null,"enabled"?: boolean,"extra_weeks"?: number,"org_id"?: string,"reminder_days"?: (number)[],"reminder_method"?: string,"schedule"?: string,"send_hour"?: number | null,"team_id"?: string,"updated_at"?: string,"updated_by"?: string | null,"window_weeks"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "serving_team_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "serving_team_settings_team_id_fkey"
      columns: ["team_id","org_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"site_settings": {
                  Row: {
                    "is_public": boolean,"key": string,"org_id": string,"updated_at": string | null,"updated_by": string | null,"value": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "is_public"?: boolean,"key": string,"org_id"?: string,"updated_at"?: string | null,"updated_by"?: string | null,"value"?: string | null
                  }
                  Update: {
                    "is_public"?: boolean,"key"?: string,"org_id"?: string,"updated_at"?: string | null,"updated_by"?: string | null,"value"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "site_settings_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"supper_contributions": {
                  Row: {
                    "group_id": string,"item": string,"org_id": string,"party_id": string,"rotation_id": string,"supper_id": string,"table_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"item": string,"org_id"?: string,"party_id": string,"rotation_id": string,"supper_id": string,"table_id": string,"updated_at"?: string
                  }
                  Update: {
                    "group_id"?: string,"item"?: string,"org_id"?: string,"party_id"?: string,"rotation_id"?: string,"supper_id"?: string,"table_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_contributions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_contributions_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    },{
      foreignKeyName: "supper_contributions_seat_fkey"
      columns: ["table_id","party_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_seats"
      referencedColumns: ["table_id","party_id","org_id"]
    },{
      foreignKeyName: "supper_contributions_supper_fkey"
      columns: ["supper_id","table_id","rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "suppers"
      referencedColumns: ["id","table_id","rotation_id","group_id","org_id"]
    }
                  ]
                },"supper_drafts": {
                  Row: {
                    "body": NonNullable<Json>,"group_id": string,"org_id": string,"rotation_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": NonNullable<Json>,"group_id": string,"org_id"?: string,"rotation_id": string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: NonNullable<Json>,"group_id"?: string,"org_id"?: string,"rotation_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_drafts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_drafts_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_feed_tokens": {
                  Row: {
                    "created_at": string,"expires_at": string,"org_id": string,"profile_id": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"org_id"?: string,"profile_id": string,"token_hash": string
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"org_id"?: string,"profile_id"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_feed_tokens_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_feed_tokens_profile_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_feed_tokens_profile_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"supper_parties": {
                  Row: {
                    "access_notes": string | null,"can_host": boolean,"created_at": string,"created_by": string | null,"group_id": string,"id": string,"kids_welcome": boolean | null,"org_id": string,"pets": string | null,"preferred_rotation_date_id": string | null,"rotation_id": string,"seats": number | null,"status": string,"updated_at": string,"withdrawn_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_notes"?: string | null,"can_host"?: boolean,"created_at"?: string,"created_by"?: string | null,"group_id": string,"id"?: string,"kids_welcome"?: boolean | null,"org_id"?: string,"pets"?: string | null,"preferred_rotation_date_id"?: string | null,"rotation_id": string,"seats"?: number | null,"status"?: string,"updated_at"?: string,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "access_notes"?: string | null,"can_host"?: boolean,"created_at"?: string,"created_by"?: string | null,"group_id"?: string,"id"?: string,"kids_welcome"?: boolean | null,"org_id"?: string,"pets"?: string | null,"preferred_rotation_date_id"?: string | null,"rotation_id"?: string,"seats"?: number | null,"status"?: string,"updated_at"?: string,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_parties_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_parties_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_parties_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_parties_preferred_date_fkey"
      columns: ["preferred_rotation_date_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotation_dates"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_parties_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_party_addresses": {
                  Row: {
                    "address_line1": string,"address_line2": string | null,"city": string | null,"group_id": string,"org_id": string,"party_id": string,"postal_code": string | null,"rotation_id": string,"state": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line1": string,"address_line2"?: string | null,"city"?: string | null,"group_id": string,"org_id"?: string,"party_id": string,"postal_code"?: string | null,"rotation_id": string,"state"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address_line1"?: string,"address_line2"?: string | null,"city"?: string | null,"group_id"?: string,"org_id"?: string,"party_id"?: string,"postal_code"?: string | null,"rotation_id"?: string,"state"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_party_addresses_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_party_addresses_party_fkey"
      columns: ["party_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_parties"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_party_addresses_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_party_members": {
                  Row: {
                    "created_at": string,"group_id": string,"org_id": string,"party_id": string,"profile_id": string,"rotation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"org_id"?: string,"party_id": string,"profile_id": string,"rotation_id": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"org_id"?: string,"party_id"?: string,"profile_id"?: string,"rotation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_party_members_group_member_fkey"
      columns: ["group_id","profile_id","org_id"]
isOneToOne: false
      referencedRelation: "group_members"
      referencedColumns: ["group_id","profile_id","org_id"]
    },{
      foreignKeyName: "supper_party_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_party_members_party_fkey"
      columns: ["party_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_parties"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_party_members_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_party_notes": {
                  Row: {
                    "food_notes": string,"group_id": string,"org_id": string,"party_id": string,"rotation_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "food_notes": string,"group_id": string,"org_id"?: string,"party_id": string,"rotation_id": string,"updated_at"?: string
                  }
                  Update: {
                    "food_notes"?: string,"group_id"?: string,"org_id"?: string,"party_id"?: string,"rotation_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_party_notes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_party_notes_party_fkey"
      columns: ["party_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_parties"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_party_notes_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_party_unavailable_dates": {
                  Row: {
                    "group_id": string,"org_id": string,"party_id": string,"rotation_date_id": string,"rotation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"org_id"?: string,"party_id": string,"rotation_date_id": string,"rotation_id": string
                  }
                  Update: {
                    "group_id"?: string,"org_id"?: string,"party_id"?: string,"rotation_date_id"?: string,"rotation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_party_unavailable_dates_date_fkey"
      columns: ["rotation_date_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotation_dates"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_party_unavailable_dates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_party_unavailable_dates_party_fkey"
      columns: ["party_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_parties"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_party_unavailable_dates_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_reminder_passes": {
                  Row: {
                    "org_id": string,"started_at": string,"supper_date": string,"supper_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id"?: string,"started_at"?: string,"supper_date": string,"supper_id": string
                  }
                  Update: {
                    "org_id"?: string,"started_at"?: string,"supper_date"?: string,"supper_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_reminder_passes_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_reminder_passes_supper_fkey"
      columns: ["supper_id","org_id"]
isOneToOne: false
      referencedRelation: "suppers"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"supper_reminder_sends": {
                  Row: {
                    "claimed_at": string | null,"org_id": string,"profile_id": string,"sent_at": string | null,"supper_date": string,"supper_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "claimed_at"?: string | null,"org_id"?: string,"profile_id": string,"sent_at"?: string | null,"supper_date": string,"supper_id": string
                  }
                  Update: {
                    "claimed_at"?: string | null,"org_id"?: string,"profile_id"?: string,"sent_at"?: string | null,"supper_date"?: string,"supper_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_reminder_sends_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_reminder_sends_pass_fkey"
      columns: ["supper_id","supper_date","org_id"]
isOneToOne: false
      referencedRelation: "supper_reminder_passes"
      referencedColumns: ["supper_id","supper_date","org_id"]
    },{
      foreignKeyName: "supper_reminder_sends_profile_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_reminder_sends_profile_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"supper_replies": {
                  Row: {
                    "org_id": string,"profile_id": string,"replied_by": string | null,"status": string,"supper_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "org_id"?: string,"profile_id": string,"replied_by"?: string | null,"status": string,"supper_id": string,"updated_at"?: string
                  }
                  Update: {
                    "org_id"?: string,"profile_id"?: string,"replied_by"?: string | null,"status"?: string,"supper_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_replies_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_replies_profile_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_replies_profile_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_replies_replied_by_fkey"
      columns: ["replied_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_replies_replied_by_fkey"
      columns: ["replied_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_replies_supper_fkey"
      columns: ["supper_id","org_id"]
isOneToOne: false
      referencedRelation: "suppers"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"supper_rotation_dates": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"org_id": string,"rotation_id": string,"starts_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"org_id"?: string,"rotation_id": string,"starts_at": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"org_id"?: string,"rotation_id"?: string,"starts_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_rotation_dates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_rotation_dates_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_rotations": {
                  Row: {
                    "allow_back_to_back_hosting": boolean,"bring_list_enabled": boolean,"created_at": string,"created_by": string | null,"default_start_time": string,"ended_at": string | null,"ends_on": string,"format": string,"group_id": string,"id": string,"length_months": number | null,"org_id": string,"previous_rotation_id": string | null,"published_at": string | null,"repeat_kind": string,"repeat_week_of_month": number | null,"repeat_weeks": number | null,"signup_closes_on": string,"starts_on": string,"status": string,"table_size_max": number,"table_size_min": number,"title": string,"updated_at": string,"weekday": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_back_to_back_hosting"?: boolean,"bring_list_enabled"?: boolean,"created_at"?: string,"created_by"?: string | null,"default_start_time"?: string,"ended_at"?: string | null,"ends_on": string,"format": string,"group_id": string,"id"?: string,"length_months"?: number | null,"org_id"?: string,"previous_rotation_id"?: string | null,"published_at"?: string | null,"repeat_kind": string,"repeat_week_of_month"?: number | null,"repeat_weeks"?: number | null,"signup_closes_on": string,"starts_on": string,"status"?: string,"table_size_max"?: number,"table_size_min"?: number,"title": string,"updated_at"?: string,"weekday": number
                  }
                  Update: {
                    "allow_back_to_back_hosting"?: boolean,"bring_list_enabled"?: boolean,"created_at"?: string,"created_by"?: string | null,"default_start_time"?: string,"ended_at"?: string | null,"ends_on"?: string,"format"?: string,"group_id"?: string,"id"?: string,"length_months"?: number | null,"org_id"?: string,"previous_rotation_id"?: string | null,"published_at"?: string | null,"repeat_kind"?: string,"repeat_week_of_month"?: number | null,"repeat_weeks"?: number | null,"signup_closes_on"?: string,"starts_on"?: string,"status"?: string,"table_size_max"?: number,"table_size_min"?: number,"title"?: string,"updated_at"?: string,"weekday"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_rotations_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_rotations_created_by_fkey"
      columns: ["created_by","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_rotations_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "supper_rotations_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_rotations_previous_rotation_id_fkey"
      columns: ["previous_rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"supper_seats": {
                  Row: {
                    "group_id": string,"left_at": string | null,"org_id": string,"party_id": string,"rotation_id": string,"seated_at": string,"table_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "group_id": string,"left_at"?: string | null,"org_id"?: string,"party_id": string,"rotation_id": string,"seated_at"?: string,"table_id": string
                  }
                  Update: {
                    "group_id"?: string,"left_at"?: string | null,"org_id"?: string,"party_id"?: string,"rotation_id"?: string,"seated_at"?: string,"table_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_seats_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_seats_party_fkey"
      columns: ["party_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_parties"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_seats_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    },{
      foreignKeyName: "supper_seats_table_fkey"
      columns: ["table_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_tables"
      referencedColumns: ["id","rotation_id","org_id"]
    }
                  ]
                },"supper_tables": {
                  Row: {
                    "created_at": string,"group_id": string,"id": string,"org_id": string,"position": number,"rotation_date_id": string | null,"rotation_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"group_id": string,"id"?: string,"org_id"?: string,"position": number,"rotation_date_id"?: string | null,"rotation_id": string
                  }
                  Update: {
                    "created_at"?: string,"group_id"?: string,"id"?: string,"org_id"?: string,"position"?: number,"rotation_date_id"?: string | null,"rotation_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "supper_tables_date_fkey"
      columns: ["rotation_date_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotation_dates"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "supper_tables_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "supper_tables_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    }
                  ]
                },"suppers": {
                  Row: {
                    "created_at": string,"follows_rotation_date": boolean,"group_id": string,"host_party_id": string | null,"host_unavailable": boolean,"id": string,"length_minutes": number,"org_id": string,"rotation_date_id": string,"rotation_id": string,"starts_at": string,"table_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"follows_rotation_date"?: boolean,"group_id": string,"host_party_id"?: string | null,"host_unavailable"?: boolean,"id"?: string,"length_minutes"?: number,"org_id"?: string,"rotation_date_id": string,"rotation_id": string,"starts_at": string,"table_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"follows_rotation_date"?: boolean,"group_id"?: string,"host_party_id"?: string | null,"host_unavailable"?: boolean,"id"?: string,"length_minutes"?: number,"org_id"?: string,"rotation_date_id"?: string,"rotation_id"?: string,"starts_at"?: string,"table_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "suppers_date_fkey"
      columns: ["rotation_date_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotation_dates"
      referencedColumns: ["id","rotation_id","org_id"]
    },{
      foreignKeyName: "suppers_host_seat_fkey"
      columns: ["table_id","host_party_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_seats"
      referencedColumns: ["table_id","party_id","org_id"]
    },{
      foreignKeyName: "suppers_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "suppers_rotation_fkey"
      columns: ["rotation_id","group_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_rotations"
      referencedColumns: ["id","group_id","org_id"]
    },{
      foreignKeyName: "suppers_table_fkey"
      columns: ["table_id","rotation_id","org_id"]
isOneToOne: false
      referencedRelation: "supper_tables"
      referencedColumns: ["id","rotation_id","org_id"]
    }
                  ]
                },"team_members": {
                  Row: {
                    "assigned_at": string,"assigned_by": string | null,"is_leader": boolean,"org_id": string,"profile_id": string,"team_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"is_leader"?: boolean,"org_id"?: string,"profile_id": string,"team_id": string
                  }
                  Update: {
                    "assigned_at"?: string,"assigned_by"?: string | null,"is_leader"?: boolean,"org_id"?: string,"profile_id"?: string,"team_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "team_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "team_members_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "team_members_profile_id_fkey"
      columns: ["profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "team_members_team_id_fkey"
      columns: ["team_id","org_id"]
isOneToOne: false
      referencedRelation: "teams"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"teams": {
                  Row: {
                    "color": string | null,"created_at": string,"created_by": string | null,"description": string | null,"display_order": number,"group_id": string,"icon": string | null,"id": string,"is_serving_role": boolean,"name": string,"org_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"display_order"?: number,"group_id": string,"icon"?: string | null,"id"?: string,"is_serving_role"?: boolean,"name": string,"org_id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "color"?: string | null,"created_at"?: string,"created_by"?: string | null,"description"?: string | null,"display_order"?: number,"group_id"?: string,"icon"?: string | null,"id"?: string,"is_serving_role"?: boolean,"name"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "teams_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "teams_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"usage_counts": {
                  Row: {
                    "kind": string,"org_id": string,"pattern": string,"total": number,"usage_date": string
                  }
                  ComputedFields: never
                  Insert: {
                    "kind": string,"org_id"?: string,"pattern": string,"total": number,"usage_date": string
                  }
                  Update: {
                    "kind"?: string,"org_id"?: string,"pattern"?: string,"total"?: number,"usage_date"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_counts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "families_directory": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"anniversary": string | null,"city": string | null,"created_at": string,"family_name": string,"id": string,"org_id": string,"phone_home": string | null,"photo_url": string | null,"postal_code": string | null,"state": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                           "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"city"?: string | null,"created_at"?: string | null,"family_name"?: string | null,"id"?: string | null,"org_id"?: string | null,"phone_home"?: never,"photo_url"?: string | null,"postal_code"?: string | null,"state"?: string | null,"updated_at"?: string | null
                         }
                        Update: {
                           "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"city"?: string | null,"created_at"?: string | null,"family_name"?: string | null,"id"?: string | null,"org_id"?: string | null,"phone_home"?: never,"photo_url"?: string | null,"postal_code"?: string | null,"state"?: string | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "family_units_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"families_directory_full": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"anniversary": string | null,"anniversary_day": number | null,"anniversary_month": number | null,"anniversary_year": number | null,"city": string | null,"created_at": string,"family_members_list": Json | null,"family_name": string,"id": string,"members": Json | null,"org_id": string,"phone_home": string | null,"phone_profile_id": string | null,"photo_url": string | null,"postal_code": string | null,"state": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                           "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"anniversary_day"?: number | null,"anniversary_month"?: number | null,"anniversary_year"?: number | null,"city"?: string | null,"created_at"?: string | null,"family_members_list"?: never,"family_name"?: string | null,"id"?: string | null,"members"?: never,"org_id"?: string | null,"phone_home"?: never,"phone_profile_id"?: string | null,"photo_url"?: string | null,"postal_code"?: string | null,"state"?: string | null,"updated_at"?: string | null
                         }
                        Update: {
                           "address_line1"?: string | null,"address_line2"?: string | null,"anniversary"?: string | null,"anniversary_day"?: number | null,"anniversary_month"?: number | null,"anniversary_year"?: number | null,"city"?: string | null,"created_at"?: string | null,"family_members_list"?: never,"family_name"?: string | null,"id"?: string | null,"members"?: never,"org_id"?: string | null,"phone_home"?: never,"phone_profile_id"?: string | null,"photo_url"?: string | null,"postal_code"?: string | null,"state"?: string | null,"updated_at"?: string | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "family_units_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "family_units_phone_profile_id_fkey"
      columns: ["phone_profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "family_units_phone_profile_id_fkey"
      columns: ["phone_profile_id","org_id"]
isOneToOne: false
      referencedRelation: "profiles_directory"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"prayer_wall": {
                  Row: {
                    "author_hash": string | null,"avatar_url": string | null,"body": string | null,"body_ciphertext": string | null,"created_at": string,"first_name": string | null,"group_id": string,"i_am_praying": boolean | null,"id": string,"is_anonymous": boolean,"is_answered": boolean,"last_name": string | null,"mine": boolean | null,"org_id": string,"praying_count": number | null,"preferred_name": string | null,"suffix": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "prayer_requests_group_id_fkey"
      columns: ["group_id","org_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "prayer_requests_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles_directory": {
                  Row: {
                    "address_line1": string | null,"address_line2": string | null,"anniversary": string | null,"avatar_url": string | null,"bio": string | null,"birth_day": number | null,"birth_month": number | null,"birth_year": number | null,"city": string | null,"created_at": string,"email": string | null,"employer": string | null,"family_id": string | null,"first_name": string | null,"gender": string | null,"groups": Json | null,"id": string,"last_name": string | null,"occupation": string | null,"org_id": string,"phone_home": string | null,"phone_mobile": string | null,"phone_work": string | null,"postal_code": string | null,"preferred_name": string | null,"relationship": string,"role": string,"state": string | null,"suffix": string | null
                  }
                  ComputedFields: never
                  Relationships: [
                    {
      foreignKeyName: "profiles_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "profiles_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "families_directory_full"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "profiles_family_id_fkey"
      columns: ["family_id","org_id"]
isOneToOne: false
      referencedRelation: "family_units"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "profiles_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "admin_member_emails":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"profile_id": string
            }[]
                           },
"app_current_org_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"app_request_org_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"create_own_household":
{ Args: { "_family_name": string }; Returns: string
                           },
"current_family_id":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"delete_person":
{ Args: { "_anonymous_request_ids"?: (string)[],"_hidden_comment_ids"?: (string)[],"_org_id": string,"_person_id": string }; Returns: Json
                           },
"discoverable_groups":
{ Args: Record<PropertyKey, never>; Returns: {
              "color": string,"description": string,"id": string,"is_private": boolean,"join_policy": string,"member_count": number,"name": string,"request_status": string,"viewer_role": string
            }[]
                           },
"email_quota_consume":
{ Args: { "_n": number,"_org_id": string }; Returns: boolean
                           },
"event_reminder_claim":
{ Args: { "_event_id": string,"_occurrence_date": string,"_org_id": string,"_reply_event_id": string }; Returns: {
              "email": string,"first_name": string,"preferred_name": string,"profile_id": string
            }[]
                           },
"event_reminder_passes_prune":
{ Args: { "_before": string,"_limit": number,"_org_id": string }; Returns: number
                           },
"family_directory_people":
{ Args: { "_family_id": string }; Returns: Json
                           },
"family_members_retire_child_details":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_own_email":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_own_role":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_profile_role":
{ Args: { "profile_id": string }; Returns: string
                           },
"giving_can_manage_fund":
{ Args: { "_fund_id": string }; Returns: boolean
                           },
"giving_funds_apply_recipient_rules":
{ Args: Record<PropertyKey, never>; Returns: Record<string, unknown>
                           },
"giving_stewards_can_manage":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"group_create":
{ Args: { "_description"?: string,"_leader_id"?: string,"_name": string }; Returns: string
                           },
"group_create_for":
{ Args: { "_created_by": string,"_description": string,"_leader": string,"_name": string,"_org": string }; Returns: string
                           },
"group_invite_join":
{ Args: { "_token": string }; Returns: string
                           },
"group_invite_redeem":
{ Args: { "_email": string,"_name": string,"_signup_token": string,"_token": string,"_token_expires_at": string }; Returns: {
              "access_request_id": string,"group_id": string,"group_name": string,"org_id": string
            }[]
                           },
"group_model_backfill":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"group_request_approve":
{ Args: { "_request_id": string }; Returns: string
                           },
"household_visible":
{ Args: { "_directory_open": boolean,"_family_id": string,"_hidden_family_ids": (string)[],"_is_admin": boolean,"_is_member": boolean,"_own_family_id": string }; Returns: boolean
                           },
"is_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_child_without_account":
{ Args: { "_claimed_profile_id": string,"_relationship": string }; Returns: boolean
                           },
"is_group_leader":
{ Args: { "_group_id": string }; Returns: boolean
                           },
"is_group_member":
{ Args: { "_group_id": string }; Returns: boolean
                           },
"is_household_manager":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_member":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_platform_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"is_serving_signup_attendee":
{ Args: { "_signup_id": string }; Returns: boolean
                           },
"is_team_lead":
{ Args: { "_team_id": string }; Returns: boolean
                           },
"join_group":
{ Args: { "_group_id": string }; Returns: string
                           },
"join_group_apply":
{ Args: { "_actor_id": string,"_group_id": string }; Returns: string
                           },
"org_directory_visible":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"org_email_domain_claim":
{ Args: { "_cap": number,"_domain": string,"_org_id": string }; Returns: {
              "cleanup_failed_at": string | null,
"created_at": string,
"dns_records": NonNullable<Json>,
"domain": string,
"id": string,
"last_checked_at": string | null,
"org_id": string,
"resend_domain_id": string | null,
"status": string,
"verified_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "org_email_domains"
        isOneToOne: true
        isSetofReturn: false
      } },
"org_group_creation_policy":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"pending_group_join_requests":
{ Args: { "_group_id": string }; Returns: {
              "created_at": string,"email": string,"first_name": string,"id": string,"last_name": string,"preferred_name": string,"suffix": string
            }[]
                           },
"person_deletion_outcomes":
{ Args: { "_org_id": string,"_person_id": string }; Returns: Json
                           },
"prayer_request_visible_author":
{ Args: { "_request_id": string }; Returns: string
                           },
"profile_directory_email":
{ Args: { "_profile_id": string }; Returns: string
                           },
"provision_organization":
{ Args: { "_name": string,"_owner_email": string }; Returns: string
                           },
"records_add_suggested_child":
{ Args: { "_suggestion_id": string }; Returns: string
                           },
"records_apply_copy":
{ Args: { "_expected": Json,"_filled": (string)[],"_grade": Json,"_household": Json,"_org_id": string,"_profile": Json,"_profile_id": string,"_values": Json }; Returns: string
                           },
"records_apply_household_copy":
{ Args: { "_connection_id": string,"_expected": Json,"_family_id": string,"_household": Json,"_org_id": string,"_values": Json }; Returns: string
                           },
"records_confirm_household":
{ Args: { "_confirmed_by": string,"_org_id": string,"_suggestion_id": string }; Returns: string
                           },
"records_dismiss_suggested_child":
{ Args: { "_suggestion_id": string }; Returns: undefined
                           },
"records_edit_state":
{ Args: { "_church_value": Json,"_columns": (string)[],"_new": Json }; Returns: string
                           },
"records_field_columns":
{ Args: { "_field": string }; Returns: (string)[]
                           },
"records_intake_claim":
{ Args: { "_org_id": string,"_profile_id": string }; Returns: string
                           },
"records_intake_consent":
{ Args: { "_org_id": string,"_profile_id": string }; Returns: string
                           },
"records_is_empty":
{ Args: { "_value": Json }; Returns: boolean
                           },
"records_live_anniversary_households":
{ Args: { "_org_id": string }; Returns: {
              "family_id": string
            }[]
                           },
"records_live_copied_count":
{ Args: { "_org_id": string }; Returns: number
                           },
"records_live_hide":
{ Args: { "_field": string,"_hidden": boolean }; Returns: undefined
                           },
"records_live_only_field":
{ Args: { "_field": string }; Returns: boolean
                           },
"records_pick":
{ Args: { "_columns": (string)[],"_row": Json }; Returns: Json
                           },
"records_replace_household_suggestions":
{ Args: { "_connection_id": string,"_org_id": string,"_suggestions": Json }; Returns: number
                           },
"records_save_children_setting":
{ Args: { "_on": boolean,"_org_id": string,"_updated_by": string }; Returns: string
                           },
"records_save_connection":
{ Args: { "_base_url": string,"_connected_by": string,"_key_ciphertext": string,"_key_hint": string,"_org_id": string,"_provider": string }; Returns: undefined
                           },
"records_save_field_settings":
{ Args: { "_org_id": string,"_settings": Json,"_updated_by": string }; Returns: string
                           },
"records_save_mode":
{ Args: { "_mode": string,"_org_id": string,"_updated_by": string }; Returns: Json
                           },
"records_sync_child_suggestions":
{ Args: { "_children": Json,"_connection_id": string,"_external_family_id": string,"_family_id": string,"_org_id": string }; Returns: number
                           },
"review_group_join_request":
{ Args: { "_approve": boolean,"_request_id": string }; Returns: string
                           },
"rsvp_set":
{ Args: { "_event_id": string,"_occurrence_date": string,"_status"?: string }; Returns: string
                           },
"serving_reminder_claim":
{ Args: { "_org_id": string,"_send_date": string,"_service_date": string,"_team_ids": (string)[] }; Returns: {
              "email": string,"first_name": string,"preferred_name": string,"profile_id": string,"team_id": string
            }[]
                           },
"serving_reminder_passes_prune":
{ Args: { "_before": string,"_limit": number,"_org_id": string }; Returns: number
                           },
"serving_signup_apply":
{ Args: { "_actor_id": string,"_attendee_ids": (string)[],"_group_id": string,"_service_date": string }; Returns: {
              "created": boolean,"signup_id": string,"signup_org_id": string
            }[]
                           },
"serving_signup_change":
{ Args: { "_attendee_ids": (string)[],"_signup_id": string }; Returns: {
              "added": number,"removed": number
            }[]
                           },
"serving_signup_create":
{ Args: { "_attendee_ids": (string)[],"_group_id": string,"_service_date": string }; Returns: {
              "created": boolean,"signup_id": string,"signup_org_id": string
            }[]
                           },
"serving_team_email_count":
{ Args: { "_team_id": string }; Returns: number
                           },
"shares_group_with":
{ Args: { "_profile_id": string }; Returns: boolean
                           },
"shares_group_with_household":
{ Args: { "_family_id": string }; Returns: boolean
                           },
"supper_address_party_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"supper_food_note_party_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"supper_my_party_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"supper_my_party_profile_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"supper_my_table_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"supper_party_create":
{ Args: { "_profile_ids": (string)[],"_rotation_id": string }; Returns: string
                           },
"supper_party_unavailable_dates_replace":
{ Args: { "_party_id": string,"_rotation_date_ids": (string)[] }; Returns: number
                           },
"supper_reminder_claim":
{ Args: { "_host_party_id": string,"_org_id": string,"_starts_at": string,"_supper_date": string,"_supper_id": string }; Returns: {
              "email": string,"first_name": string,"preferred_name": string,"profile_id": string
            }[]
                           },
"supper_reminder_passes_prune":
{ Args: { "_before": string,"_limit": number,"_org_id": string }; Returns: number
                           },
"supper_rotation_dates_replace":
{ Args: { "_rotation_id": string,"_starts_at": (string)[] }; Returns: number
                           },
"supper_seat_signatures":
{ Args: { "_org_id": string,"_rotation_id": string }; Returns: Json
                           },
"supper_signup_window_open":
{ Args: { "_rotation_id": string }; Returns: boolean
                           },
"supper_tablemate_party_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"supper_tables_publish":
{ Args: { "_rotation_id": string }; Returns: {
              "profile_id": string
            }[]
                           },
"unlisted_household_ids":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           },
"usage_count_record":
{ Args: { "_kind": string,"_pattern": string }; Returns: boolean
                           },
"usage_count_totals":
{ Args: { "_days": number,"_org_id": string }; Returns: {
              "kind": string,"pattern": string,"total": number
            }[]
                           },
"usage_counts_prune":
{ Args: { "_before": string,"_limit": number,"_org_id": string }; Returns: number
                           },
"usage_page_patterns":
{ Args: Record<PropertyKey, never>; Returns: (string)[]
                           }
          }
          Enums: {
            "org_domain_status": "pending"|"verified"|"failed"|"removing","org_status": "active"|"suspended"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "org_domain_status": ["pending", "verified", "failed", "removing"],"org_status": ["active", "suspended"]
          }
        }
} as const

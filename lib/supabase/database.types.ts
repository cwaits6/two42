export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      about_page: {
        Row: {
          body: string
          id: boolean
          org_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string
          id?: boolean
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          id?: boolean
          org_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "about_page_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      access_requests: {
        Row: {
          approved_role: string | null
          created_at: string
          email: string
          id: string
          invite_token: string | null
          message: string | null
          name: string
          org_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          signup_token: string | null
          status: string
          token_expires_at: string | null
        }
        Insert: {
          approved_role?: string | null
          created_at?: string
          email: string
          id?: string
          invite_token?: string | null
          message?: string | null
          name: string
          org_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          signup_token?: string | null
          status?: string
          token_expires_at?: string | null
        }
        Update: {
          approved_role?: string | null
          created_at?: string
          email?: string
          id?: string
          invite_token?: string | null
          message?: string | null
          name?: string
          org_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          signup_token?: string | null
          status?: string
          token_expires_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_requests_invite_token_fkey"
            columns: ["invite_token", "org_id"]
            isOneToOne: false
            referencedRelation: "family_invites"
            referencedColumns: ["token", "org_id"]
          },
          {
            foreignKeyName: "access_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          author_id: string | null
          content: string
          created_at: string
          id: string
          is_published: boolean
          org_id: string
          published_at: string | null
          title: string
        }
        Insert: {
          author_id?: string | null
          content: string
          created_at?: string
          id?: string
          is_published?: boolean
          org_id?: string
          published_at?: string | null
          title: string
        }
        Update: {
          author_id?: string | null
          content?: string
          created_at?: string
          id?: string
          is_published?: boolean
          org_id?: string
          published_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "announcements_author_id_fkey"
            columns: ["author_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "announcements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_subscription_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          org_id: string
          token_hash: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          org_id?: string
          token_hash: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          org_id?: string
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_subscription_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_subscription_tokens_user_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "calendar_subscription_tokens_user_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      class_teachers: {
        Row: {
          bio: string
          created_at: string
          id: string
          org_id: string
          profile_id: string
          sort_order: number
          title: string
        }
        Insert: {
          bio?: string
          created_at?: string
          id?: string
          org_id?: string
          profile_id: string
          sort_order?: number
          title?: string
        }
        Update: {
          bio?: string
          created_at?: string
          id?: string
          org_id?: string
          profile_id?: string
          sort_order?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_teachers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_teachers_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "class_teachers_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: true
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      event_calendars: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          org_id?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_calendars_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "event_calendars_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "event_calendars_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          calendar_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          end_time: string | null
          id: string
          is_rsvp_enabled: boolean
          location: string | null
          meeting_id: string | null
          meeting_lead_minutes: number
          meeting_passcode: string | null
          meeting_show_on_dashboard: boolean
          meeting_url: string | null
          org_id: string
          recurrence_count: number | null
          recurrence_end_mode: string | null
          recurrence_frequency: string | null
          recurrence_interval: number
          recurrence_until: string | null
          series_id: string | null
          series_occurrence_date: string | null
          start_time: string
          title: string
        }
        Insert: {
          calendar_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string | null
          id?: string
          is_rsvp_enabled?: boolean
          location?: string | null
          meeting_id?: string | null
          meeting_lead_minutes?: number
          meeting_passcode?: string | null
          meeting_show_on_dashboard?: boolean
          meeting_url?: string | null
          org_id?: string
          recurrence_count?: number | null
          recurrence_end_mode?: string | null
          recurrence_frequency?: string | null
          recurrence_interval?: number
          recurrence_until?: string | null
          series_id?: string | null
          series_occurrence_date?: string | null
          start_time: string
          title: string
        }
        Update: {
          calendar_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_time?: string | null
          id?: string
          is_rsvp_enabled?: boolean
          location?: string | null
          meeting_id?: string | null
          meeting_lead_minutes?: number
          meeting_passcode?: string | null
          meeting_show_on_dashboard?: boolean
          meeting_url?: string | null
          org_id?: string
          recurrence_count?: number | null
          recurrence_end_mode?: string | null
          recurrence_frequency?: string | null
          recurrence_interval?: number
          recurrence_until?: string | null
          series_id?: string | null
          series_occurrence_date?: string | null
          start_time?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_calendar_id_fkey"
            columns: ["calendar_id", "org_id"]
            isOneToOne: false
            referencedRelation: "event_calendars"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "events_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_series_id_fkey"
            columns: ["series_id", "org_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      family_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string | null
          family_id: string
          family_member_id: string
          id: string
          invite_email: string
          org_id: string
          sent_at: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          family_id: string
          family_member_id: string
          id?: string
          invite_email: string
          org_id?: string
          sent_at?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          family_id?: string
          family_member_id?: string
          id?: string
          invite_email?: string
          org_id?: string
          sent_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_invites_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_invites_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory_full"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_invites_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "family_units"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_invites_family_member_id_fkey"
            columns: ["family_member_id", "org_id"]
            isOneToOne: false
            referencedRelation: "family_members"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      family_members: {
        Row: {
          avatar_url: string | null
          birth_day: number | null
          birth_month: number | null
          birth_year: number | null
          claimed_profile_id: string | null
          created_at: string
          family_id: string
          first_name: string
          id: string
          is_class_member: boolean
          last_name: string | null
          org_id: string
          preferred_name: string | null
          relationship: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          claimed_profile_id?: string | null
          created_at?: string
          family_id: string
          first_name: string
          id?: string
          is_class_member?: boolean
          last_name?: string | null
          org_id?: string
          preferred_name?: string | null
          relationship: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          claimed_profile_id?: string | null
          created_at?: string
          family_id?: string
          first_name?: string
          id?: string
          is_class_member?: boolean
          last_name?: string | null
          org_id?: string
          preferred_name?: string | null
          relationship?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory_full"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "family_units"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "family_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      family_units: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          anniversary: string | null
          city: string | null
          created_at: string
          family_name: string
          hide_address: boolean
          hide_phone_home: boolean
          id: string
          org_id: string
          phone_home: string | null
          photo_url: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          anniversary?: string | null
          city?: string | null
          created_at?: string
          family_name: string
          hide_address?: boolean
          hide_phone_home?: boolean
          id?: string
          org_id?: string
          phone_home?: string | null
          photo_url?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          anniversary?: string | null
          city?: string | null
          created_at?: string
          family_name?: string
          hide_address?: boolean
          hide_phone_home?: boolean
          id?: string
          org_id?: string
          phone_home?: string | null
          photo_url?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_units_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          message: string
          org_id: string
          profile_id: string | null
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          org_id?: string
          profile_id?: string | null
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          org_id?: string
          profile_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "feedback_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      giving_fund_methods: {
        Row: {
          custom_handle: string
          display_order: number
          fund_id: string
          method: string
          org_id: string
        }
        Insert: {
          custom_handle: string
          display_order?: number
          fund_id: string
          method: string
          org_id?: string
        }
        Update: {
          custom_handle?: string
          display_order?: number
          fund_id?: string
          method?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "giving_fund_methods_fund_id_fkey"
            columns: ["fund_id", "org_id"]
            isOneToOne: false
            referencedRelation: "giving_funds"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "giving_fund_methods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      giving_funds: {
        Row: {
          co_steward_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          id: string
          is_active: boolean
          name: string
          org_id: string
          retire_on: string | null
          steward_id: string
          steward_role: string | null
          updated_at: string
        }
        Insert: {
          co_steward_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          org_id?: string
          retire_on?: string | null
          steward_id: string
          steward_role?: string | null
          updated_at?: string
        }
        Update: {
          co_steward_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          retire_on?: string | null
          steward_id?: string
          steward_role?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "giving_funds_co_steward_id_fkey"
            columns: ["co_steward_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "giving_funds_co_steward_id_fkey"
            columns: ["co_steward_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "giving_funds_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "giving_funds_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "giving_funds_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "giving_funds_steward_id_fkey"
            columns: ["steward_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "giving_funds_steward_id_fkey"
            columns: ["steward_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      lecture_series: {
        Row: {
          created_at: string
          id: string
          is_archived: boolean
          name: string
          org_id: string
          teacher: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name: string
          org_id?: string
          teacher?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_archived?: boolean
          name?: string
          org_id?: string
          teacher?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lecture_series_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lectures: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          lecture_date: string | null
          org_id: string
          scripture_reference: string | null
          series_id: string | null
          summary: string | null
          thumbnail_url: string | null
          title: string
          video_url: string
          week_number: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lecture_date?: string | null
          org_id?: string
          scripture_reference?: string | null
          series_id?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          title: string
          video_url: string
          week_number?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lecture_date?: string | null
          org_id?: string
          scripture_reference?: string | null
          series_id?: string | null
          summary?: string | null
          thumbnail_url?: string | null
          title?: string
          video_url?: string
          week_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lectures_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "lectures_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "lectures_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lectures_series_id_fkey"
            columns: ["series_id", "org_id"]
            isOneToOne: false
            referencedRelation: "lecture_series"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      member_groups: {
        Row: {
          color: string | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number
          icon: string | null
          id: string
          is_serving_role: boolean
          name: string
          org_id: string
          show_in_directory_filter: boolean
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_serving_role?: boolean
          name: string
          org_id?: string
          show_in_directory_filter?: boolean
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_serving_role?: boolean
          name?: string
          org_id?: string
          show_in_directory_filter?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_groups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          org_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          org_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          branding: Json
          created_at: string
          id: string
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
        }
        Insert: {
          branding?: Json
          created_at?: string
          id?: string
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
        }
        Update: {
          branding?: Json
          created_at?: string
          id?: string
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
        }
        Relationships: []
      }
      page_content: {
        Row: {
          body: string
          org_id: string
          slug: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string
          org_id?: string
          slug: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          org_id?: string
          slug?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_content_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admins: {
        Row: {
          created_at: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          profile_id: string
        }
        Update: {
          created_at?: string
          profile_id?: string
        }
        Relationships: []
      }
      prayer_call_sessions: {
        Row: {
          created_at: string
          dial_in: string | null
          display_order: number
          end_time: string | null
          event_id: string | null
          id: string
          join_url: string | null
          leader_id: string | null
          org_id: string
          pin: string | null
          start_time: string
          updated_at: string
          weekday: number
        }
        Insert: {
          created_at?: string
          dial_in?: string | null
          display_order?: number
          end_time?: string | null
          event_id?: string | null
          id?: string
          join_url?: string | null
          leader_id?: string | null
          org_id?: string
          pin?: string | null
          start_time: string
          updated_at?: string
          weekday: number
        }
        Update: {
          created_at?: string
          dial_in?: string | null
          display_order?: number
          end_time?: string | null
          event_id?: string | null
          id?: string
          join_url?: string | null
          leader_id?: string | null
          org_id?: string
          pin?: string | null
          start_time?: string
          updated_at?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "prayer_call_sessions_event_id_fkey"
            columns: ["event_id", "org_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_call_sessions_leader_id_fkey"
            columns: ["leader_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_call_sessions_leader_id_fkey"
            columns: ["leader_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_call_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_requests: {
        Row: {
          author_id: string
          body: string
          category: string
          created_at: string
          id: string
          is_anonymous: boolean
          is_answered: boolean
          org_id: string
          updated_at: string
          visible_to_warriors: boolean
        }
        Insert: {
          author_id: string
          body: string
          category: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          is_answered?: boolean
          org_id?: string
          updated_at?: string
          visible_to_warriors?: boolean
        }
        Update: {
          author_id?: string
          body?: string
          category?: string
          created_at?: string
          id?: string
          is_anonymous?: boolean
          is_answered?: boolean
          org_id?: string
          updated_at?: string
          visible_to_warriors?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "prayer_requests_author_id_fkey"
            columns: ["author_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_requests_author_id_fkey"
            columns: ["author_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_responses: {
        Row: {
          created_at: string
          org_id: string
          profile_id: string
          request_id: string
        }
        Insert: {
          created_at?: string
          org_id?: string
          profile_id: string
          request_id: string
        }
        Update: {
          created_at?: string
          org_id?: string
          profile_id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prayer_responses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prayer_responses_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_responses_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_responses_request_id_fkey"
            columns: ["request_id", "org_id"]
            isOneToOne: false
            referencedRelation: "prayer_requests"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "prayer_responses_request_id_fkey"
            columns: ["request_id", "org_id"]
            isOneToOne: false
            referencedRelation: "prayer_wall"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      profile_groups: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          group_id: string
          is_leader: boolean
          org_id: string
          profile_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          group_id: string
          is_leader?: boolean
          org_id?: string
          profile_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          group_id?: string
          is_leader?: boolean
          org_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_groups_group_id_fkey"
            columns: ["group_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_groups"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profile_groups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_groups_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profile_groups_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      profiles: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          anniversary: string | null
          approved_at: string | null
          approved_by: string | null
          avatar_url: string | null
          bio: string | null
          birth_day: number | null
          birth_month: number | null
          birth_year: number | null
          city: string | null
          created_at: string
          email: string | null
          email_announcements: boolean
          employer: string | null
          family_id: string | null
          first_name: string | null
          hide_address: boolean
          hide_anniversary: boolean
          hide_birth_year: boolean
          hide_birthday: boolean
          hide_email: boolean
          hide_occupation: boolean
          hide_phone_home: boolean
          hide_phone_mobile: boolean
          hide_phone_work: boolean
          id: string
          is_unlisted: boolean
          last_name: string | null
          occupation: string | null
          org_id: string
          phone: string | null
          phone_home: string | null
          phone_mobile: string | null
          phone_work: string | null
          postal_code: string | null
          preferred_name: string | null
          relationship: string
          role: string
          setup_completed: boolean
          state: string | null
          updated_at: string
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          anniversary?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          bio?: string | null
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          city?: string | null
          created_at?: string
          email?: string | null
          email_announcements?: boolean
          employer?: string | null
          family_id?: string | null
          first_name?: string | null
          hide_address?: boolean
          hide_anniversary?: boolean
          hide_birth_year?: boolean
          hide_birthday?: boolean
          hide_email?: boolean
          hide_occupation?: boolean
          hide_phone_home?: boolean
          hide_phone_mobile?: boolean
          hide_phone_work?: boolean
          id: string
          is_unlisted?: boolean
          last_name?: string | null
          occupation?: string | null
          org_id?: string
          phone?: string | null
          phone_home?: string | null
          phone_mobile?: string | null
          phone_work?: string | null
          postal_code?: string | null
          preferred_name?: string | null
          relationship?: string
          role?: string
          setup_completed?: boolean
          state?: string | null
          updated_at?: string
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          anniversary?: string | null
          approved_at?: string | null
          approved_by?: string | null
          avatar_url?: string | null
          bio?: string | null
          birth_day?: number | null
          birth_month?: number | null
          birth_year?: number | null
          city?: string | null
          created_at?: string
          email?: string | null
          email_announcements?: boolean
          employer?: string | null
          family_id?: string | null
          first_name?: string | null
          hide_address?: boolean
          hide_anniversary?: boolean
          hide_birth_year?: boolean
          hide_birthday?: boolean
          hide_email?: boolean
          hide_occupation?: boolean
          hide_phone_home?: boolean
          hide_phone_mobile?: boolean
          hide_phone_work?: boolean
          id?: string
          is_unlisted?: boolean
          last_name?: string | null
          occupation?: string | null
          org_id?: string
          phone?: string | null
          phone_home?: string | null
          phone_mobile?: string | null
          phone_work?: string | null
          postal_code?: string | null
          preferred_name?: string | null
          relationship?: string
          role?: string
          setup_completed?: boolean
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory_full"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "family_units"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          org_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          org_id?: string
          status: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          org_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_event_id_fkey"
            columns: ["event_id", "org_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "rsvps_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_user_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "rsvps_user_id_fkey"
            columns: ["user_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      serving_broadcasts: {
        Row: {
          created_at: string
          group_id: string
          id: string
          open_dates: string[]
          org_id: string
          recipient_count: number
          sent_by: string | null
          subject: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          open_dates?: string[]
          org_id?: string
          recipient_count?: number
          sent_by?: string | null
          subject: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          open_dates?: string[]
          org_id?: string
          recipient_count?: number
          sent_by?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "serving_broadcasts_group_id_fkey"
            columns: ["group_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_groups"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_broadcasts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serving_broadcasts_sent_by_fkey"
            columns: ["sent_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_broadcasts_sent_by_fkey"
            columns: ["sent_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      serving_signup_attendees: {
        Row: {
          org_id: string
          profile_id: string
          signup_id: string
        }
        Insert: {
          org_id?: string
          profile_id: string
          signup_id: string
        }
        Update: {
          org_id?: string
          profile_id?: string
          signup_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "serving_signup_attendees_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "serving_signup_attendees_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signup_attendees_profile_id_fkey"
            columns: ["profile_id", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signup_attendees_signup_id_fkey"
            columns: ["signup_id", "org_id"]
            isOneToOne: false
            referencedRelation: "serving_signups"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      serving_signups: {
        Row: {
          created_at: string
          created_by: string
          family_id: string | null
          group_id: string
          id: string
          org_id: string
          service_date: string
        }
        Insert: {
          created_at?: string
          created_by: string
          family_id?: string | null
          group_id: string
          id?: string
          org_id?: string
          service_date: string
        }
        Update: {
          created_at?: string
          created_by?: string
          family_id?: string | null
          group_id?: string
          id?: string
          org_id?: string
          service_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "serving_signups_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signups_created_by_fkey"
            columns: ["created_by", "org_id"]
            isOneToOne: false
            referencedRelation: "profiles_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signups_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signups_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory_full"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signups_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "family_units"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signups_group_id_fkey"
            columns: ["group_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_groups"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_signups_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      serving_team_settings: {
        Row: {
          enabled: boolean
          group_id: string
          org_id: string
          reminder_days: number[]
          reminder_method: string
          updated_at: string
          updated_by: string | null
          window_weeks: number
        }
        Insert: {
          enabled?: boolean
          group_id: string
          org_id?: string
          reminder_days?: number[]
          reminder_method?: string
          updated_at?: string
          updated_by?: string | null
          window_weeks?: number
        }
        Update: {
          enabled?: boolean
          group_id?: string
          org_id?: string
          reminder_days?: number[]
          reminder_method?: string
          updated_at?: string
          updated_by?: string | null
          window_weeks?: number
        }
        Relationships: [
          {
            foreignKeyName: "serving_team_settings_group_id_fkey"
            columns: ["group_id", "org_id"]
            isOneToOne: false
            referencedRelation: "member_groups"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "serving_team_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          is_public: boolean
          key: string
          org_id: string
          updated_at: string | null
          updated_by: string | null
          value: string | null
        }
        Insert: {
          is_public?: boolean
          key: string
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string | null
        }
        Update: {
          is_public?: boolean
          key?: string
          org_id?: string
          updated_at?: string | null
          updated_by?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      families_directory: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          anniversary: string | null
          city: string | null
          created_at: string | null
          family_name: string | null
          id: string | null
          org_id: string | null
          phone_home: string | null
          photo_url: string | null
          postal_code: string | null
          state: string | null
          updated_at: string | null
        }
        Insert: {
          address_line1?: never
          address_line2?: never
          anniversary?: string | null
          city?: never
          created_at?: string | null
          family_name?: string | null
          id?: string | null
          org_id?: string | null
          phone_home?: never
          photo_url?: string | null
          postal_code?: never
          state?: never
          updated_at?: string | null
        }
        Update: {
          address_line1?: never
          address_line2?: never
          anniversary?: string | null
          city?: never
          created_at?: string | null
          family_name?: string | null
          id?: string | null
          org_id?: string | null
          phone_home?: never
          photo_url?: string | null
          postal_code?: never
          state?: never
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_units_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      families_directory_full: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          anniversary: string | null
          city: string | null
          created_at: string | null
          family_members_list: Json | null
          family_name: string | null
          id: string | null
          members: Json | null
          org_id: string | null
          phone_home: string | null
          photo_url: string | null
          postal_code: string | null
          state: string | null
          updated_at: string | null
        }
        Insert: {
          address_line1?: never
          address_line2?: never
          anniversary?: string | null
          city?: never
          created_at?: string | null
          family_members_list?: never
          family_name?: string | null
          id?: string | null
          members?: never
          org_id?: string | null
          phone_home?: never
          photo_url?: string | null
          postal_code?: never
          state?: never
          updated_at?: string | null
        }
        Update: {
          address_line1?: never
          address_line2?: never
          anniversary?: string | null
          city?: never
          created_at?: string | null
          family_members_list?: never
          family_name?: string | null
          id?: string | null
          members?: never
          org_id?: string | null
          phone_home?: never
          photo_url?: string | null
          postal_code?: never
          state?: never
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "family_units_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      prayer_wall: {
        Row: {
          avatar_url: string | null
          body: string | null
          category: string | null
          created_at: string | null
          first_name: string | null
          i_am_praying: boolean | null
          id: string | null
          is_anonymous: boolean | null
          is_answered: boolean | null
          last_name: string | null
          mine: boolean | null
          org_id: string | null
          praying_count: number | null
          preferred_name: string | null
          visible_to_warriors: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "prayer_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles_directory: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          anniversary: string | null
          avatar_url: string | null
          bio: string | null
          birth_day: number | null
          birth_month: number | null
          birth_year: number | null
          city: string | null
          created_at: string | null
          email: string | null
          employer: string | null
          family_id: string | null
          first_name: string | null
          groups: Json | null
          id: string | null
          last_name: string | null
          occupation: string | null
          org_id: string | null
          phone_home: string | null
          phone_mobile: string | null
          phone_work: string | null
          postal_code: string | null
          preferred_name: string | null
          relationship: string | null
          role: string | null
          state: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "families_directory_full"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profiles_family_id_fkey"
            columns: ["family_id", "org_id"]
            isOneToOne: false
            referencedRelation: "family_units"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      app_current_org_id: { Args: never; Returns: string }
      app_request_org_id: { Args: never; Returns: string }
      current_family_id: { Args: never; Returns: string }
      get_own_email: { Args: never; Returns: string }
      get_own_role: { Args: never; Returns: string }
      get_profile_email: { Args: { profile_id: string }; Returns: string }
      get_profile_role: { Args: { profile_id: string }; Returns: string }
      giving_can_manage_fund: { Args: { _fund_id: string }; Returns: boolean }
      giving_stewards_can_manage: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_content_editor: { Args: never; Returns: boolean }
      is_group_leader: { Args: { _group_id: string }; Returns: boolean }
      is_household_manager: { Args: never; Returns: boolean }
      is_member: { Args: never; Returns: boolean }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      provision_organization: {
        Args: { _name: string; _owner_email: string; _slug: string }
        Returns: string
      }
      serving_signup_apply: {
        Args: {
          _actor_id: string
          _attendee_ids: string[]
          _group_id: string
          _service_date: string
        }
        Returns: {
          created: boolean
          signup_id: string
          signup_org_id: string
        }[]
      }
      serving_signup_create: {
        Args: {
          _attendee_ids: string[]
          _group_id: string
          _service_date: string
        }
        Returns: {
          created: boolean
          signup_id: string
          signup_org_id: string
        }[]
      }
    }
    Enums: {
      org_status: "active" | "suspended"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      org_status: ["active", "suspended"],
    },
  },
} as const


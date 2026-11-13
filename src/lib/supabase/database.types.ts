export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      activity_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["activity_entity_type"];
          household_id: string;
          id: string;
          summary: NonNullable<Json>;
          type: Database["public"]["Enums"]["activity_event_type"];
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          entity_id: string;
          entity_type: Database["public"]["Enums"]["activity_entity_type"];
          household_id: string;
          id?: string;
          summary?: NonNullable<Json>;
          type: Database["public"]["Enums"]["activity_event_type"];
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          entity_id?: string;
          entity_type?: Database["public"]["Enums"]["activity_entity_type"];
          household_id?: string;
          id?: string;
          summary?: NonNullable<Json>;
          type?: Database["public"]["Enums"]["activity_event_type"];
        };
        Relationships: [
          {
            foreignKeyName: "activity_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_events_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      bill_occurrences: {
        Row: {
          bill_id: string;
          created_at: string;
          due_on: string;
          expected_amount_minor: number;
          household_id: string;
          id: string;
          skipped_at: string | null;
          skipped_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          bill_id: string;
          created_at?: string;
          due_on: string;
          expected_amount_minor: number;
          household_id: string;
          id?: string;
          skipped_at?: string | null;
          skipped_by?: string | null;
        };
        Update: {
          bill_id?: string;
          created_at?: string;
          due_on?: string;
          expected_amount_minor?: number;
          household_id?: string;
          id?: string;
          skipped_at?: string | null;
          skipped_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bill_occurrences_bill_fkey";
            columns: ["bill_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "recurring_bills";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "bill_occurrences_skipped_by_fkey";
            columns: ["skipped_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      chores: {
        Row: {
          assignee_id: string | null;
          completed_at: string | null;
          completed_by: string | null;
          created_at: string;
          created_by: string;
          creation_key: string | null;
          description: string | null;
          due_on: string | null;
          household_id: string;
          id: string;
          priority: Database["public"]["Enums"]["chore_priority"];
          removed_at: string | null;
          removed_by: string | null;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          assignee_id?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by: string;
          creation_key?: string | null;
          description?: string | null;
          due_on?: string | null;
          household_id: string;
          id?: string;
          priority?: Database["public"]["Enums"]["chore_priority"];
          removed_at?: string | null;
          removed_by?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          assignee_id?: string | null;
          completed_at?: string | null;
          completed_by?: string | null;
          created_at?: string;
          created_by?: string;
          creation_key?: string | null;
          description?: string | null;
          due_on?: string | null;
          household_id?: string;
          id?: string;
          priority?: Database["public"]["Enums"]["chore_priority"];
          removed_at?: string | null;
          removed_by?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "chores_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chores_completed_by_fkey";
            columns: ["completed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chores_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chores_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "chores_removed_by_fkey";
            columns: ["removed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_splits: {
        Row: {
          expense_id: string;
          household_id: string;
          percentage_bp: number | null;
          share_minor: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          expense_id: string;
          household_id: string;
          percentage_bp?: number | null;
          share_minor: number;
          user_id: string;
        };
        Update: {
          expense_id?: string;
          household_id?: string;
          percentage_bp?: number | null;
          share_minor?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_splits_expense_fkey";
            columns: ["expense_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "expenses";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "expense_splits_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          amount_minor: number;
          category: Database["public"]["Enums"]["expense_category"];
          created_at: string;
          created_by: string;
          creation_key: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          description: string;
          expense_date: string;
          household_id: string;
          id: string;
          paid_by: string;
          recurrence_period: string | null;
          recurring_bill_id: string | null;
          split_method: Database["public"]["Enums"]["split_method"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_minor: number;
          category: Database["public"]["Enums"]["expense_category"];
          created_at?: string;
          created_by: string;
          creation_key?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description: string;
          expense_date: string;
          household_id: string;
          id?: string;
          paid_by: string;
          recurrence_period?: string | null;
          recurring_bill_id?: string | null;
          split_method: Database["public"]["Enums"]["split_method"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          category?: Database["public"]["Enums"]["expense_category"];
          created_at?: string;
          created_by?: string;
          creation_key?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          description?: string;
          expense_date?: string;
          household_id?: string;
          id?: string;
          paid_by?: string;
          recurrence_period?: string | null;
          recurring_bill_id?: string | null;
          split_method?: Database["public"]["Enums"]["split_method"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expenses_bill_occurrence_fkey";
            columns: ["recurring_bill_id", "recurrence_period", "household_id"];
            isOneToOne: false;
            referencedRelation: "bill_occurrences";
            referencedColumns: ["bill_id", "due_on", "household_id"];
          },
          {
            foreignKeyName: "expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_deleted_by_fkey";
            columns: ["deleted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expenses_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      household_members: {
        Row: {
          household_id: string;
          id: string;
          joined_at: string;
          left_at: string | null;
          role: Database["public"]["Enums"]["household_role"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          household_id: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          role?: Database["public"]["Enums"]["household_role"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          household_id?: string;
          id?: string;
          joined_at?: string;
          left_at?: string | null;
          role?: Database["public"]["Enums"]["household_role"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "household_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          created_at: string;
          created_by: string;
          creation_key: string | null;
          currency_code: string;
          id: string;
          name: string;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by: string;
          creation_key?: string | null;
          currency_code?: string;
          id?: string;
          name: string;
          timezone: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          creation_key?: string | null;
          currency_code?: string;
          id?: string;
          name?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "households_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          created_at: string;
          created_by: string;
          expires_at: string;
          household_id: string;
          id: string;
          max_uses: number;
          revoked_at: string | null;
          token_hash: string;
          use_count: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          household_id: string;
          id?: string;
          max_uses?: number;
          revoked_at?: string | null;
          token_hash: string;
          use_count?: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          expires_at?: string;
          household_id?: string;
          id?: string;
          max_uses?: number;
          revoked_at?: string | null;
          token_hash?: string;
          use_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      recurring_bill_shares: {
        Row: {
          bill_id: string;
          household_id: string;
          percentage_bp: number | null;
          share_minor: number | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          bill_id: string;
          household_id: string;
          percentage_bp?: number | null;
          share_minor?: number | null;
          user_id: string;
        };
        Update: {
          bill_id?: string;
          household_id?: string;
          percentage_bp?: number | null;
          share_minor?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_bill_shares_bill_fkey";
            columns: ["bill_id", "household_id"];
            isOneToOne: false;
            referencedRelation: "recurring_bills";
            referencedColumns: ["id", "household_id"];
          },
          {
            foreignKeyName: "recurring_bill_shares_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_bills: {
        Row: {
          amount_minor: number;
          anchor_on: string;
          category: Database["public"]["Enums"]["expense_category"];
          created_at: string;
          created_by: string;
          creation_key: string | null;
          description: string;
          ends_on: string | null;
          frequency: Database["public"]["Enums"]["bill_frequency"];
          household_id: string;
          id: string;
          interval_count: number;
          next_index: number;
          notes: string | null;
          paused_at: string | null;
          paused_by: string | null;
          payer_id: string;
          split_method: Database["public"]["Enums"]["split_method"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_minor: number;
          anchor_on: string;
          category: Database["public"]["Enums"]["expense_category"];
          created_at?: string;
          created_by: string;
          creation_key?: string | null;
          description: string;
          ends_on?: string | null;
          frequency: Database["public"]["Enums"]["bill_frequency"];
          household_id: string;
          id?: string;
          interval_count: number;
          next_index?: number;
          notes?: string | null;
          paused_at?: string | null;
          paused_by?: string | null;
          payer_id: string;
          split_method: Database["public"]["Enums"]["split_method"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          anchor_on?: string;
          category?: Database["public"]["Enums"]["expense_category"];
          created_at?: string;
          created_by?: string;
          creation_key?: string | null;
          description?: string;
          ends_on?: string | null;
          frequency?: Database["public"]["Enums"]["bill_frequency"];
          household_id?: string;
          id?: string;
          interval_count?: number;
          next_index?: number;
          notes?: string | null;
          paused_at?: string | null;
          paused_by?: string | null;
          payer_id?: string;
          split_method?: Database["public"]["Enums"]["split_method"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recurring_bills_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_bills_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_bills_paused_by_fkey";
            columns: ["paused_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recurring_bills_payer_id_fkey";
            columns: ["payer_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      settlements: {
        Row: {
          amount_minor: number;
          created_at: string;
          creation_key: string | null;
          from_user: string;
          household_id: string;
          id: string;
          note: string | null;
          recorded_by: string;
          settled_on: string;
          to_user: string;
          voided_at: string | null;
          voided_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          amount_minor: number;
          created_at?: string;
          creation_key?: string | null;
          from_user: string;
          household_id: string;
          id?: string;
          note?: string | null;
          recorded_by: string;
          settled_on: string;
          to_user: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Update: {
          amount_minor?: number;
          created_at?: string;
          creation_key?: string | null;
          from_user?: string;
          household_id?: string;
          id?: string;
          note?: string | null;
          recorded_by?: string;
          settled_on?: string;
          to_user?: string;
          voided_at?: string | null;
          voided_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settlements_from_user_fkey";
            columns: ["from_user"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_to_user_fkey";
            columns: ["to_user"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settlements_voided_by_fkey";
            columns: ["voided_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      shopping_items: {
        Row: {
          added_by: string;
          assignee_id: string | null;
          created_at: string;
          creation_key: string | null;
          household_id: string;
          id: string;
          name: string;
          note: string | null;
          purchased_at: string | null;
          purchased_by: string | null;
          quantity: string | null;
          removed_at: string | null;
          removed_by: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          added_by: string;
          assignee_id?: string | null;
          created_at?: string;
          creation_key?: string | null;
          household_id: string;
          id?: string;
          name: string;
          note?: string | null;
          purchased_at?: string | null;
          purchased_by?: string | null;
          quantity?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          updated_at?: string;
        };
        Update: {
          added_by?: string;
          assignee_id?: string | null;
          created_at?: string;
          creation_key?: string | null;
          household_id?: string;
          id?: string;
          name?: string;
          note?: string | null;
          purchased_at?: string | null;
          purchased_by?: string | null;
          quantity?: string | null;
          removed_at?: string | null;
          removed_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "shopping_items_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shopping_items_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shopping_items_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shopping_items_purchased_by_fkey";
            columns: ["purchased_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "shopping_items_removed_by_fkey";
            columns: ["removed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_invite: {
        Args: { token: string };
        Returns: {
          already_member: boolean;
          joined_household_id: string;
        }[];
      };
      add_shopping_item: {
        Args: {
          item_assignee_id?: string;
          item_name: string;
          item_note?: string;
          item_quantity?: string;
          request_key?: string;
          target_household_id: string;
        };
        Returns: string;
      };
      complete_chore: { Args: { target_chore_id: string }; Returns: undefined };
      create_chore: {
        Args: {
          chore_assignee_id?: string;
          chore_description?: string;
          chore_due_on?: string;
          chore_priority_level?: Database["public"]["Enums"]["chore_priority"];
          chore_title: string;
          request_key?: string;
          target_household_id: string;
        };
        Returns: string;
      };
      create_expense: {
        Args: {
          amount: number;
          expense_category: Database["public"]["Enums"]["expense_category"];
          method: Database["public"]["Enums"]["split_method"];
          payer_id: string;
          request_key?: string;
          shares: Json;
          spent_on: string;
          target_household_id: string;
          title: string;
        };
        Returns: string;
      };
      create_household: {
        Args: {
          currency: string;
          household_name: string;
          request_key?: string;
          time_zone: string;
        };
        Returns: string;
      };
      create_recurring_bill: {
        Args: {
          amount: number;
          bill_category: Database["public"]["Enums"]["expense_category"];
          bill_payer_id: string;
          first_due_on: string;
          last_due_on?: string;
          memo?: string;
          method: Database["public"]["Enums"]["split_method"];
          repeat_every: number;
          repeat_unit: Database["public"]["Enums"]["bill_frequency"];
          request_key?: string;
          shares: Json;
          target_household_id: string;
          title: string;
        };
        Returns: string;
      };
      delete_expense: {
        Args: { target_expense_id: string };
        Returns: undefined;
      };
      delete_household: {
        Args: { target_household_id: string };
        Returns: undefined;
      };
      end_recurring_bill: {
        Args: { target_bill_id: string };
        Returns: undefined;
      };
      expense_history: {
        Args: {
          amount_max?: number;
          amount_min?: number;
          categories?: Database["public"]["Enums"]["expense_category"][];
          date_from?: string;
          date_to?: string;
          deleted_only?: boolean;
          page_number?: number;
          page_size?: number;
          payers?: string[];
          search_categories?: Database["public"]["Enums"]["expense_category"][];
          search_text?: string;
          sort_order?: string;
          target_household_id: string;
        };
        Returns: Json;
      };
      get_invite_preview: {
        Args: { token: string };
        Returns: {
          household_id: string;
          household_name: string;
          inviter_name: string;
          status: string;
        }[];
      };
      household_balances: {
        Args: { focus_user_id?: string; target_household_id: string };
        Returns: Json;
      };
      household_bills: { Args: { target_household_id: string }; Returns: Json };
      household_journal: {
        Args: {
          before_id?: string;
          before_us?: number;
          category_filter?: string;
          page_size?: number;
          target_household_id: string;
        };
        Returns: Json;
      };
      leave_household: {
        Args: { target_household_id: string };
        Returns: undefined;
      };
      pause_recurring_bill: {
        Args: { target_bill_id: string };
        Returns: undefined;
      };
      purchase_shopping_item: {
        Args: { target_item_id: string };
        Returns: undefined;
      };
      record_bill_payment: {
        Args: {
          amount: number;
          expense_category: Database["public"]["Enums"]["expense_category"];
          method: Database["public"]["Enums"]["split_method"];
          occurrence_due_on: string;
          payer_id: string;
          request_key?: string;
          shares: Json;
          spent_on: string;
          target_bill_id: string;
          title: string;
        };
        Returns: string;
      };
      record_settlement: {
        Args: {
          acknowledged_owed?: number;
          amount: number;
          memo?: string;
          paid_on: string;
          payer_id: string;
          recipient_id: string;
          request_key?: string;
          target_household_id: string;
        };
        Returns: string;
      };
      recurring_bill: { Args: { target_bill_id: string }; Returns: Json };
      remove_chore: { Args: { target_chore_id: string }; Returns: undefined };
      remove_member: {
        Args: { member_user_id: string; target_household_id: string };
        Returns: undefined;
      };
      remove_shopping_item: {
        Args: { target_item_id: string };
        Returns: undefined;
      };
      reopen_chore: { Args: { target_chore_id: string }; Returns: undefined };
      reopen_shopping_item: {
        Args: { target_item_id: string };
        Returns: undefined;
      };
      reschedule_recurring_bill: {
        Args: {
          expected_updated_at?: string;
          next_due_on: string;
          repeat_every: number;
          repeat_unit: Database["public"]["Enums"]["bill_frequency"];
          target_bill_id: string;
        };
        Returns: undefined;
      };
      restore_expense: {
        Args: { target_expense_id: string };
        Returns: undefined;
      };
      resume_recurring_bill: {
        Args: { target_bill_id: string };
        Returns: undefined;
      };
      skip_bill_occurrence: {
        Args: { occurrence_due_on: string; target_bill_id: string };
        Returns: undefined;
      };
      transfer_ownership: {
        Args: { new_owner_user_id: string; target_household_id: string };
        Returns: undefined;
      };
      unskip_bill_occurrence: {
        Args: { occurrence_due_on: string; target_bill_id: string };
        Returns: undefined;
      };
      update_chore: {
        Args: {
          chore_assignee_id?: string;
          chore_description?: string;
          chore_due_on?: string;
          chore_priority_level?: Database["public"]["Enums"]["chore_priority"];
          chore_title: string;
          expected_updated_at?: string;
          target_chore_id: string;
        };
        Returns: undefined;
      };
      update_expense: {
        Args: {
          amount: number;
          expected_updated_at?: string;
          expense_category: Database["public"]["Enums"]["expense_category"];
          method: Database["public"]["Enums"]["split_method"];
          payer_id: string;
          shares: Json;
          spent_on: string;
          target_expense_id: string;
          title: string;
        };
        Returns: undefined;
      };
      update_recurring_bill: {
        Args: {
          amount: number;
          bill_category: Database["public"]["Enums"]["expense_category"];
          bill_payer_id: string;
          expected_updated_at?: string;
          last_due_on?: string;
          memo?: string;
          method: Database["public"]["Enums"]["split_method"];
          shares: Json;
          target_bill_id: string;
          title: string;
        };
        Returns: undefined;
      };
      update_shopping_item: {
        Args: {
          expected_updated_at?: string;
          item_assignee_id?: string;
          item_name: string;
          item_note?: string;
          item_quantity?: string;
          target_item_id: string;
        };
        Returns: undefined;
      };
      void_settlement: {
        Args: { target_settlement_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      activity_entity_type:
        | "household"
        | "household_member"
        | "invitation"
        | "expense"
        | "settlement"
        | "recurring_bill"
        | "shopping_item"
        | "chore";
      activity_event_type:
        | "household_created"
        | "member_joined"
        | "member_left"
        | "member_removed"
        | "ownership_transferred"
        | "invitation_created"
        | "invitation_revoked"
        | "expense_created"
        | "expense_updated"
        | "expense_deleted"
        | "expense_restored"
        | "settlement_recorded"
        | "settlement_voided"
        | "bill_created"
        | "bill_updated"
        | "bill_paused"
        | "bill_resumed"
        | "bill_ended"
        | "bill_skipped"
        | "bill_unskipped"
        | "shopping_item_added"
        | "shopping_item_updated"
        | "shopping_item_purchased"
        | "shopping_item_reopened"
        | "shopping_item_removed"
        | "chore_created"
        | "chore_updated"
        | "chore_completed"
        | "chore_reopened"
        | "chore_removed";
      bill_frequency: "week" | "month" | "year";
      chore_priority: "low" | "medium" | "high";
      expense_category:
        | "rent"
        | "utilities"
        | "groceries"
        | "household_supplies"
        | "internet"
        | "dining"
        | "transport"
        | "other";
      household_role: "owner" | "member";
      split_method: "equal" | "percentage" | "custom";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      activity_entity_type: [
        "household",
        "household_member",
        "invitation",
        "expense",
        "settlement",
        "recurring_bill",
        "shopping_item",
        "chore",
      ],
      activity_event_type: [
        "household_created",
        "member_joined",
        "member_left",
        "member_removed",
        "ownership_transferred",
        "invitation_created",
        "invitation_revoked",
        "expense_created",
        "expense_updated",
        "expense_deleted",
        "expense_restored",
        "settlement_recorded",
        "settlement_voided",
        "bill_created",
        "bill_updated",
        "bill_paused",
        "bill_resumed",
        "bill_ended",
        "bill_skipped",
        "bill_unskipped",
        "shopping_item_added",
        "shopping_item_updated",
        "shopping_item_purchased",
        "shopping_item_reopened",
        "shopping_item_removed",
        "chore_created",
        "chore_updated",
        "chore_completed",
        "chore_reopened",
        "chore_removed",
      ],
      bill_frequency: ["week", "month", "year"],
      chore_priority: ["low", "medium", "high"],
      expense_category: [
        "rent",
        "utilities",
        "groceries",
        "household_supplies",
        "internet",
        "dining",
        "transport",
        "other",
      ],
      household_role: ["owner", "member"],
      split_method: ["equal", "percentage", "custom"],
    },
  },
} as const;

-- Security advisor: pin search_path on the inbox helper functions.
alter function public.email_addr(text) set search_path = public;
alter function public.email_name(text) set search_path = public;
alter function public.base_subject(text) set search_path = public;
alter function public.email_refs(jsonb) set search_path = public;

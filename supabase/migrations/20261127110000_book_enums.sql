-- Postgres can't use a new enum value in the transaction that adds it, so the
-- values get their own migration; books.sql uses them.
alter type public.media_type add value 'book';
alter type public.provider add value 'hardcover';

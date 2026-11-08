-- Apply once to an existing Wattar database to enable secure public room access.

CREATE OR REPLACE FUNCTION public.create_room_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.room_seats (
        room_id, seat_index, user_id, status, is_owner_seat, joined_at
    )
    SELECT
        NEW.id,
        seat.seat_index::SMALLINT,
        CASE WHEN seat.seat_index = 0 THEN NEW.owner_id ELSE NULL END,
        CASE WHEN seat.seat_index = 0
            THEN 'occupied'::public.seat_status
            ELSE 'empty'::public.seat_status
        END,
        seat.seat_index = 0,
        CASE WHEN seat.seat_index = 0 THEN now() ELSE NULL END
    FROM generate_series(0, NEW.seat_count - 1) AS seat(seat_index);

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_room_seats_after_insert ON public.rooms;
CREATE TRIGGER create_room_seats_after_insert
    AFTER INSERT ON public.rooms
    FOR EACH ROW EXECUTE FUNCTION public.create_room_seats();

DROP POLICY IF EXISTS rooms_public_select ON public.rooms;
CREATE POLICY rooms_public_select ON public.rooms
    FOR SELECT USING (
        (status <> 'closed' AND NOT is_private) OR auth.uid() = owner_id
    );
DROP POLICY IF EXISTS rooms_owner_insert ON public.rooms;
CREATE POLICY rooms_owner_insert ON public.rooms
    FOR INSERT WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS rooms_owner_update ON public.rooms;
CREATE POLICY rooms_owner_update ON public.rooms
    FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS room_seats_room_select ON public.room_seats;
CREATE POLICY room_seats_room_select ON public.room_seats
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.rooms AS room
            WHERE room.id = room_seats.room_id
              AND room.status <> 'closed'
              AND (NOT room.is_private OR room.owner_id = auth.uid())
        )
    );
DROP POLICY IF EXISTS room_seats_claim ON public.room_seats;
CREATE POLICY room_seats_claim ON public.room_seats
    FOR UPDATE
    USING (user_id IS NULL OR user_id = auth.uid())
    WITH CHECK (
        (user_id = auth.uid() AND status = 'occupied')
        OR (user_id IS NULL AND status = 'empty')
    );
REVOKE UPDATE ON public.room_seats FROM authenticated;
GRANT UPDATE (user_id, status, is_mic_on, joined_at)
    ON public.room_seats TO authenticated;

DROP POLICY IF EXISTS room_messages_room_select ON public.room_messages;
CREATE POLICY room_messages_room_select ON public.room_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.rooms AS room
            WHERE room.id = room_messages.room_id
              AND room.status <> 'closed'
              AND (NOT room.is_private OR room.owner_id = auth.uid())
        )
    );
DROP POLICY IF EXISTS room_messages_insert ON public.room_messages;
CREATE POLICY room_messages_insert ON public.room_messages
    FOR INSERT WITH CHECK (
        auth.uid() = user_id
        AND NOT is_system
        AND EXISTS (
            SELECT 1 FROM public.rooms AS room
            WHERE room.id = room_messages.room_id
              AND room.status <> 'closed'
              AND (NOT room.is_private OR room.owner_id = auth.uid())
        )
    );

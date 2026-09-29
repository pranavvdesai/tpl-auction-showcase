-- Show the programme year instead of the intake: 2025 intake is MBA 2, 2024 intake is MBA 1.
update public.players
   set batch = case
     when roll_no like '25%' then 'MBA 2'
     when roll_no like '24%' then 'MBA 1'
     else null
   end
 where true;

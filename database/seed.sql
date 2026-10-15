
-- Insert only missing shared categories; never overwrite user records.
INSERT INTO categories (user_id,name,type) VALUES
 (NULL,'Salary','income'),(NULL,'Freelance','income'),(NULL,'Business','income'),(NULL,'Other Income','income'),
 (NULL,'Food','expense'),(NULL,'Travel','expense'),(NULL,'Shopping','expense'),(NULL,'Rent','expense'),
 (NULL,'Bills','expense'),(NULL,'Entertainment','expense'),(NULL,'Healthcare','expense')
ON CONFLICT (owner_key,name,type) DO NOTHING;

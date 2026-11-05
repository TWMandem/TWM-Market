# WorkManager создаёт свою базу (Room) по имени класса — не трогать при сжатии кода.
-keep class * extends androidx.room.RoomDatabase { <init>(...); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
-keep class * extends androidx.work.ListenableWorker { <init>(...); }

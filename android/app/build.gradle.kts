plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.psyche.agentdock"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.psyche.agentdock"
        minSdk = 24
        targetSdk = 36
        versionCode = 8300
        versionName = "0.8.3"
        resValue("string", "agentdock_core_version", "0.8.3")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}